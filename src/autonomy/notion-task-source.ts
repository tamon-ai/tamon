import { queryDatabase, updatePage } from "../core/notion";
import { getNotion } from "../core/notion";
import * as logger from "../utils/logger";
import type { Task, TaskSource } from "./types";

// Notionプロパティ名のデフォルトマッピング
interface PropertyMapping {
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  owner: string;
  executionType: string;
  notes: string;
  source: string;
}

const DEFAULT_PROPERTY_MAP: PropertyMapping = {
  title: "Name",
  status: "Status",
  priority: "Priority",
  dueDate: "Due Date",
  owner: "Owner",
  executionType: "Execution Type",
  notes: "Notes",
  source: "Source",
};

// Notionステータスとタスクステータスのマッピング
const STATUS_MAP: Record<string, Task["status"]> = {
  "未着手": "pending",
  "Not started": "pending",
  "pending": "pending",
  "進行中": "in_progress",
  "In progress": "in_progress",
  "in_progress": "in_progress",
  "完了": "done",
  "Done": "done",
  "done": "done",
  "棄却": "rejected",
  "Rejected": "rejected",
  "rejected": "rejected",
};

const REVERSE_STATUS_MAP: Record<Task["status"], string> = {
  pending: "Not started",
  in_progress: "In progress",
  done: "Done",
  rejected: "Rejected",
};

const PRIORITY_MAP: Record<string, Task["priority"]> = {
  "高": "high",
  "High": "high",
  "high": "high",
  "中": "medium",
  "Medium": "medium",
  "medium": "medium",
  "低": "low",
  "Low": "low",
  "low": "low",
};

export class NotionTaskSource implements TaskSource {
  private readonly databaseId: string;
  private readonly propertyMap: PropertyMapping;
  private readonly reverseStatusMap: Record<Task["status"], string>;

  constructor(
    databaseId: string,
    options?: {
      propertyMap?: Partial<PropertyMapping>;
      reverseStatusMap?: Record<Task["status"], string>;
    },
  ) {
    this.databaseId = databaseId;
    this.propertyMap = { ...DEFAULT_PROPERTY_MAP, ...options?.propertyMap };
    this.reverseStatusMap = options?.reverseStatusMap ?? REVERSE_STATUS_MAP;
  }

  async fetchTasks(): Promise<Task[]> {
    // 未完了タスクのみ取得
    const filter = {
      and: [
        {
          property: this.propertyMap.status,
          status: {
            does_not_equal: this.reverseStatusMap.done,
          },
        },
        {
          property: this.propertyMap.status,
          status: {
            does_not_equal: this.reverseStatusMap.rejected,
          },
        },
      ],
    };

    const sorts = [
      { property: this.propertyMap.dueDate, direction: "ascending" as const },
    ];

    try {
      const pages = await queryDatabase(this.databaseId, filter, sorts);
      return pages.map((page: any) => this.mapPageToTask(page));
    } catch (err) {
      logger.error("[notion-task-source] Failed to fetch tasks", err);
      return [];
    }
  }

  async updateStatus(taskId: string, status: Task["status"]): Promise<void> {
    const notionStatus = this.reverseStatusMap[status];
    if (!notionStatus) {
      logger.warn(`[notion-task-source] Unknown status mapping for: ${status}`);
      return;
    }

    try {
      await updatePage(taskId, {
        [this.propertyMap.status]: {
          status: { name: notionStatus },
        },
      });
      logger.info(`[notion-task-source] Updated task ${taskId} status to ${notionStatus}`);
    } catch (err) {
      logger.error(`[notion-task-source] Failed to update status for ${taskId}`, err);
      throw err;
    }
  }

  async addNote(taskId: string, note: string): Promise<void> {
    try {
      // ページのブロック子要素としてコメントを追加
      const notion = getNotion();
      const timestamp = new Date().toISOString();
      await notion.blocks.children.append({
        block_id: taskId,
        children: [
          {
            object: "block" as const,
            type: "callout" as const,
            callout: {
              rich_text: [
                {
                  type: "text" as const,
                  text: { content: `[${timestamp}] ${note}` },
                },
              ],
              icon: { type: "emoji" as const, emoji: "🤖" as const },
            },
          },
        ],
      });
      logger.debug(`[notion-task-source] Added note to task ${taskId}`);
    } catch (err) {
      logger.error(`[notion-task-source] Failed to add note to ${taskId}`, err);
      throw err;
    }
  }

  private mapPageToTask(page: any): Task {
    const props = page.properties;

    return {
      id: page.id,
      title: this.extractTitle(props[this.propertyMap.title]),
      status: this.extractStatus(props[this.propertyMap.status]),
      priority: this.extractPriority(props[this.propertyMap.priority]),
      dueDate: this.extractDate(props[this.propertyMap.dueDate]),
      owner: this.extractRichText(props[this.propertyMap.owner]),
      executionType: this.extractSelect(props[this.propertyMap.executionType]) as Task["executionType"],
      notes: this.extractRichText(props[this.propertyMap.notes]),
      source: this.extractRichText(props[this.propertyMap.source]),
    };
  }

  private extractTitle(prop: any): string {
    if (!prop?.title?.length) return "(untitled)";
    return prop.title.map((t: any) => t.plain_text).join("");
  }

  private extractStatus(prop: any): Task["status"] {
    const name = prop?.status?.name || prop?.select?.name || "";
    return STATUS_MAP[name] ?? "pending";
  }

  private extractPriority(prop: any): Task["priority"] {
    const name = prop?.select?.name || "";
    return PRIORITY_MAP[name] ?? "medium";
  }

  private extractDate(prop: any): string | undefined {
    return prop?.date?.start || undefined;
  }

  private extractRichText(prop: any): string | undefined {
    if (!prop?.rich_text?.length) return undefined;
    return prop.rich_text.map((t: any) => t.plain_text).join("");
  }

  private extractSelect(prop: any): string | undefined {
    return prop?.select?.name || undefined;
  }
}
