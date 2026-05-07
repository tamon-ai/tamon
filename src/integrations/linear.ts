import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getConfig } from "../config";

// Linear GraphQL API連携
// API Keyで認証

const LINEAR_API = "https://api.linear.app/graphql";

// --- Types ---

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  state: { name: string; color: string };
  assignee: { name: string; email: string } | null;
  team: { key: string; name: string };
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

// --- Internal types ---

interface LinearGraphQLResponse<T = Record<string, unknown>> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

// --- Issue fields fragment（クエリ重複排除用） ---

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  state { name color }
  assignee { name email }
  team { key name }
  createdAt
  updatedAt
  url
`;

// --- Internal helpers ---

/** Linear設定済みか判定 */
export function isLinearConfigured(): boolean {
  const config = getConfig();
  return !!config.linear.apiKey;
}

/** Linear API Keyを取得 */
function getApiKey(): string {
  const config = getConfig();
  const apiKey = config.linear.apiKey;
  if (!apiKey) {
    throw new Error("Linear API key not configured");
  }
  return apiKey;
}

/** Linear GraphQLリクエスト共通 */
async function linearGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const apiKey = getApiKey();

  return withRetry(
    async () => {
      const resp = await fetch(LINEAR_API, {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!resp.ok) {
        throw new Error(`Linear HTTP error (${resp.status}): ${resp.statusText}`);
      }

      const result = (await resp.json()) as LinearGraphQLResponse<T>;

      if (result.errors?.length) {
        const messages = result.errors.map((e) => e.message).join("; ");
        throw new Error(`Linear GraphQL error: ${messages}`);
      }

      if (!result.data) {
        throw new Error("Linear GraphQL returned no data");
      }

      return result.data;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/** APIレスポンスからIssue型に変換 */
function mapIssue(node: Record<string, unknown>): LinearIssue {
  const state = node.state as Record<string, unknown> | undefined;
  const assignee = node.assignee as Record<string, unknown> | undefined;
  const team = node.team as Record<string, unknown> | undefined;

  return {
    id: (node.id as string) || "",
    identifier: (node.identifier as string) || "",
    title: (node.title as string) || "",
    description: (node.description as string) || null,
    priority: (node.priority as number) || 0,
    state: {
      name: (state?.name as string) || "",
      color: (state?.color as string) || "",
    },
    assignee: assignee
      ? { name: (assignee.name as string) || "", email: (assignee.email as string) || "" }
      : null,
    team: {
      key: (team?.key as string) || "",
      name: (team?.name as string) || "",
    },
    createdAt: (node.createdAt as string) || "",
    updatedAt: (node.updatedAt as string) || "",
    url: (node.url as string) || "",
  };
}

// --- Public API ---

/**
 * Issue一覧を取得（フィルタ付き）
 * @param opts フィルタオプション
 */
export async function getIssues(
  opts?: { teamKey?: string; state?: string; assignee?: string; limit?: number },
): Promise<LinearIssue[]> {
  if (!isLinearConfigured()) {
    logger.debug("[linear] Linear未設定のためスキップ");
    return [];
  }

  try {
    // フィルタ条件を動的に組み立て
    const filterParts: string[] = [];
    if (opts?.teamKey) {
      filterParts.push(`team: { key: { eq: "${opts.teamKey}" } }`);
    }
    if (opts?.state) {
      filterParts.push(`state: { name: { eq: "${opts.state}" } }`);
    }
    if (opts?.assignee) {
      filterParts.push(`assignee: { name: { eq: "${opts.assignee}" } }`);
    }

    const filterArg = filterParts.length > 0
      ? `filter: { ${filterParts.join(", ")} }, `
      : "";
    const limit = opts?.limit || 50;

    const query = `
      query {
        issues(${filterArg}first: ${limit}, orderBy: updatedAt) {
          nodes { ${ISSUE_FIELDS} }
        }
      }
    `;

    const data = await linearGraphQL<{
      issues: { nodes: Array<Record<string, unknown>> };
    }>(query);

    return (data.issues?.nodes || []).map(mapIssue);
  } catch (err) {
    logger.error("[linear] Issue一覧取得エラー", err);
    return [];
  }
}

/**
 * 自分にアサインされたIssueを取得
 * @param limit 取得件数（デフォルト50）
 */
export async function getMyIssues(limit = 50): Promise<LinearIssue[]> {
  if (!isLinearConfigured()) {
    logger.debug("[linear] Linear未設定のためスキップ");
    return [];
  }

  try {
    const query = `
      query {
        viewer {
          assignedIssues(first: ${limit}, orderBy: updatedAt) {
            nodes { ${ISSUE_FIELDS} }
          }
        }
      }
    `;

    const data = await linearGraphQL<{
      viewer: { assignedIssues: { nodes: Array<Record<string, unknown>> } };
    }>(query);

    return (data.viewer?.assignedIssues?.nodes || []).map(mapIssue);
  } catch (err) {
    logger.error("[linear] 自分のIssue取得エラー", err);
    return [];
  }
}

/**
 * Issueを作成
 * @param params Issue作成パラメータ
 */
export async function createIssue(
  params: {
    teamId: string;
    title: string;
    description?: string;
    priority?: number;
    stateId?: string;
  },
): Promise<LinearIssue | null> {
  if (!isLinearConfigured()) {
    throw new Error("Linear not configured");
  }

  try {
    const inputParts: string[] = [
      `teamId: "${params.teamId}"`,
      `title: "${params.title.replace(/"/g, '\\"')}"`,
    ];
    if (params.description) {
      inputParts.push(`description: "${params.description.replace(/"/g, '\\"')}"`);
    }
    if (params.priority !== undefined) {
      inputParts.push(`priority: ${params.priority}`);
    }
    if (params.stateId) {
      inputParts.push(`stateId: "${params.stateId}"`);
    }

    const query = `
      mutation {
        issueCreate(input: { ${inputParts.join(", ")} }) {
          success
          issue { ${ISSUE_FIELDS} }
        }
      }
    `;

    const data = await linearGraphQL<{
      issueCreate: {
        success: boolean;
        issue: Record<string, unknown>;
      };
    }>(query);

    if (!data.issueCreate?.success || !data.issueCreate.issue) {
      logger.warn("[linear] Issue作成がsuccessでない");
      return null;
    }

    logger.debug("[linear] Issue作成完了", data.issueCreate.issue.identifier);
    return mapIssue(data.issueCreate.issue);
  } catch (err) {
    logger.error("[linear] Issue作成エラー", err);
    return null;
  }
}

/**
 * Issueを更新
 * @param issueId Issue ID
 * @param params 更新パラメータ
 */
export async function updateIssue(
  issueId: string,
  params: { stateId?: string; priority?: number; assigneeId?: string },
): Promise<boolean> {
  if (!isLinearConfigured()) {
    throw new Error("Linear not configured");
  }

  try {
    const inputParts: string[] = [];
    if (params.stateId) {
      inputParts.push(`stateId: "${params.stateId}"`);
    }
    if (params.priority !== undefined) {
      inputParts.push(`priority: ${params.priority}`);
    }
    if (params.assigneeId) {
      inputParts.push(`assigneeId: "${params.assigneeId}"`);
    }

    if (inputParts.length === 0) {
      logger.warn("[linear] 更新パラメータが空");
      return false;
    }

    const query = `
      mutation {
        issueUpdate(id: "${issueId}", input: { ${inputParts.join(", ")} }) {
          success
        }
      }
    `;

    const data = await linearGraphQL<{
      issueUpdate: { success: boolean };
    }>(query);

    const success = data.issueUpdate?.success ?? false;
    if (success) {
      logger.debug("[linear] Issue更新完了", issueId);
    }
    return success;
  } catch (err) {
    logger.error("[linear] Issue更新エラー", err);
    return false;
  }
}

/**
 * チーム一覧を取得
 */
export async function getTeams(): Promise<LinearTeam[]> {
  if (!isLinearConfigured()) {
    logger.debug("[linear] Linear未設定のためスキップ");
    return [];
  }

  try {
    const query = `
      query {
        teams {
          nodes {
            id
            key
            name
            description
          }
        }
      }
    `;

    const data = await linearGraphQL<{
      teams: { nodes: Array<Record<string, unknown>> };
    }>(query);

    return (data.teams?.nodes || []).map((t) => ({
      id: (t.id as string) || "",
      key: (t.key as string) || "",
      name: (t.name as string) || "",
      description: (t.description as string) || null,
    }));
  } catch (err) {
    logger.error("[linear] チーム一覧取得エラー", err);
    return [];
  }
}

/**
 * Issue検索
 * @param query 検索クエリ
 * @param limit 取得件数（デフォルト20）
 */
export async function searchIssues(
  query: string,
  limit = 20,
): Promise<LinearIssue[]> {
  if (!isLinearConfigured()) {
    logger.debug("[linear] Linear未設定のためスキップ");
    return [];
  }

  try {
    const gql = `
      query SearchIssues($query: String!, $limit: Int!) {
        searchIssues(query: $query, first: $limit) {
          nodes { ${ISSUE_FIELDS} }
        }
      }
    `;

    const data = await linearGraphQL<{
      searchIssues: { nodes: Array<Record<string, unknown>> };
    }>(gql, { query, limit });

    return (data.searchIssues?.nodes || []).map(mapIssue);
  } catch (err) {
    logger.error("[linear] Issue検索エラー", err);
    return [];
  }
}
