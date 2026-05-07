/**
 * Autonomous task execution with Notion.
 * Fetches tasks from a Notion database, scores them, and executes the top ones.
 *
 * Usage:
 *   npm install tamon-ai
 *   # Set NOTION_API_KEY and NOTION_DATABASES=tasks:your-db-id in .env
 *   npx tsx autonomous-tasks.ts
 */

import {
  getConfig,
  initNotion,
  TaskExecutor,
  NotionTaskSource,
  canRunAutonomousTasks,
  logger,
} from "tamon-ai";

async function main(): Promise<void> {
  const config = getConfig();

  if (!config.notion.apiKey || !config.notion.databases["tasks"]) {
    console.error("Set NOTION_API_KEY and NOTION_DATABASES=tasks:your-db-id");
    process.exit(1);
  }

  initNotion(config.notion.apiKey);

  const source = new NotionTaskSource(config.notion.databases["tasks"]);

  const executor = new TaskExecutor({
    taskSource: source,
    maxConcurrent: 1,
    maxFailuresPerDay: 2,
    systemPrompt: "You are a task execution agent. Complete each task thoroughly.",

    onTaskComplete: async (task, result) => {
      logger.info(`[auto] Completed: ${task.title}`);
      logger.info(`[auto] Result: ${result.slice(0, 200)}`);
    },

    onTaskFailed: async (task, error) => {
      logger.warn(`[auto] Failed: ${task.title} — ${error.slice(0, 200)}`);
    },

    onReviewNeeded: async (task, result) => {
      logger.info(`[auto] Review needed: ${task.title}`);
      logger.info(`[auto] ${result.slice(0, 200)}`);
    },
  });

  const { allowed, reason } = canRunAutonomousTasks();
  if (!allowed) {
    logger.info(`[auto] Skipping: ${reason}`);
    return;
  }

  logger.info("[auto] Starting autonomous task execution cycle...");
  await executor.run();
  logger.info("[auto] Cycle complete.");
}

main().catch(console.error);
