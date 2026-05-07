import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getConfig } from "../config";

// GitHub REST API v3連携
// Personal Access Token (PAT) で認証

const GITHUB_API = "https://api.github.com";

// --- Types ---

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  language: string | null;
  stargazersCount: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  body: string | null;
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  headBranch: string;
  baseBranch: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface GitHubEvent {
  type: string;
  repo: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export interface GitHubNotification {
  id: string;
  reason: string;
  subject: { title: string; type: string; url: string | null };
  repository: string;
  updatedAt: string;
  unread: boolean;
}

// --- Internal types ---

interface GitHubApiError {
  message?: string;
  documentation_url?: string;
}

// --- Internal helpers ---

/** GitHub設定済みか判定 */
export function isGitHubConfigured(): boolean {
  const config = getConfig();
  return !!config.github.token;
}

/** GitHub PATを取得 */
function getToken(): string {
  const config = getConfig();
  const token = config.github.token;
  if (!token) {
    throw new Error("GitHub token not configured");
  }
  return token;
}

/** 共通ヘッダー */
function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/** GitHub APIリクエスト共通（GET） */
async function ghGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const token = getToken();
  let url = `${GITHUB_API}${path}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  return withRetry(
    async () => {
      const resp = await fetch(url, {
        method: "GET",
        headers: headers(token),
      });

      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as GitHubApiError;
        throw new Error(
          `GitHub API error (${resp.status}): ${body.message || resp.statusText}`,
        );
      }

      return (await resp.json()) as T;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/** GitHub APIリクエスト共通（POST） */
async function ghPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = getToken();
  const url = `${GITHUB_API}${path}`;

  return withRetry(
    async () => {
      const resp = await fetch(url, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => ({}))) as GitHubApiError;
        throw new Error(
          `GitHub API error (${resp.status}): ${errBody.message || resp.statusText}`,
        );
      }

      return (await resp.json()) as T;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

// --- Public API ---

/**
 * ユーザーまたはorgの直近アクティビティを取得
 * @param owner ユーザー名またはorg名
 * @param maxResults 取得件数（デフォルト30、API上限100）
 */
export async function getRecentActivity(
  owner: string,
  maxResults = 30,
): Promise<GitHubEvent[]> {
  if (!isGitHubConfigured()) {
    logger.debug("[github] GitHub未設定のためスキップ");
    return [];
  }

  try {
    const events = await ghGet<Array<{
      type: string;
      repo?: { name?: string };
      created_at?: string;
      payload?: Record<string, unknown>;
    }>>(`/users/${encodeURIComponent(owner)}/events`, {
      per_page: String(Math.min(maxResults, 100)),
    });

    return events.map((e) => ({
      type: e.type || "",
      repo: e.repo?.name || "",
      createdAt: e.created_at || "",
      payload: e.payload,
    }));
  } catch (err) {
    logger.error("[github] アクティビティ取得エラー", err);
    return [];
  }
}

/**
 * ユーザーまたはorgのリポジトリ一覧を取得
 * @param owner ユーザー名またはorg名
 */
export async function getRepositories(owner: string): Promise<GitHubRepo[]> {
  if (!isGitHubConfigured()) {
    logger.debug("[github] GitHub未設定のためスキップ");
    return [];
  }

  try {
    // orgの場合は /orgs/:owner/repos、ユーザーの場合は /users/:owner/repos
    // まずorgを試し、404ならユーザーにフォールバック
    let repos: Array<Record<string, unknown>>;
    try {
      repos = await ghGet<Array<Record<string, unknown>>>(
        `/orgs/${encodeURIComponent(owner)}/repos`,
        { per_page: "100", sort: "updated" },
      );
    } catch {
      repos = await ghGet<Array<Record<string, unknown>>>(
        `/users/${encodeURIComponent(owner)}/repos`,
        { per_page: "100", sort: "updated" },
      );
    }

    return repos.map((r) => ({
      id: r.id as number,
      name: (r.name as string) || "",
      fullName: (r.full_name as string) || "",
      description: (r.description as string) || null,
      private: (r.private as boolean) || false,
      defaultBranch: (r.default_branch as string) || "main",
      updatedAt: (r.updated_at as string) || "",
      language: (r.language as string) || null,
      stargazersCount: (r.stargazers_count as number) || 0,
    }));
  } catch (err) {
    logger.error("[github] リポジトリ一覧取得エラー", err);
    return [];
  }
}

/**
 * リポジトリのIssue一覧を取得
 * @param owner リポジトリオーナー
 * @param repo リポジトリ名
 * @param opts フィルタオプション
 */
export async function getIssues(
  owner: string,
  repo: string,
  opts?: { state?: "open" | "closed" | "all"; labels?: string[] },
): Promise<GitHubIssue[]> {
  if (!isGitHubConfigured()) {
    logger.debug("[github] GitHub未設定のためスキップ");
    return [];
  }

  try {
    const query: Record<string, string> = {
      per_page: "50",
      state: opts?.state || "open",
    };
    if (opts?.labels?.length) {
      query.labels = opts.labels.join(",");
    }

    const issues = await ghGet<Array<Record<string, unknown>>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      query,
    );

    // GitHub APIはIssueエンドポイントにPRも含むため、pull_requestキーで除外
    return issues
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number as number,
        title: (i.title as string) || "",
        state: (i.state as string) || "",
        body: (i.body as string) || null,
        labels: ((i.labels as Array<{ name?: string }>) || []).map((l) => l.name || ""),
        assignees: ((i.assignees as Array<{ login?: string }>) || []).map((a) => a.login || ""),
        createdAt: (i.created_at as string) || "",
        updatedAt: (i.updated_at as string) || "",
        htmlUrl: (i.html_url as string) || "",
      }));
  } catch (err) {
    logger.error("[github] Issue一覧取得エラー", err);
    return [];
  }
}

/**
 * リポジトリのPull Request一覧を取得
 * @param owner リポジトリオーナー
 * @param repo リポジトリ名
 * @param opts フィルタオプション
 */
export async function getPullRequests(
  owner: string,
  repo: string,
  opts?: { state?: "open" | "closed" | "all" },
): Promise<GitHubPR[]> {
  if (!isGitHubConfigured()) {
    logger.debug("[github] GitHub未設定のためスキップ");
    return [];
  }

  try {
    const prs = await ghGet<Array<Record<string, unknown>>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      { per_page: "50", state: opts?.state || "open" },
    );

    return prs.map((pr) => ({
      number: pr.number as number,
      title: (pr.title as string) || "",
      state: (pr.state as string) || "",
      draft: (pr.draft as boolean) || false,
      merged: !!(pr.merged_at),
      headBranch: ((pr.head as Record<string, unknown>)?.ref as string) || "",
      baseBranch: ((pr.base as Record<string, unknown>)?.ref as string) || "",
      createdAt: (pr.created_at as string) || "",
      updatedAt: (pr.updated_at as string) || "",
      htmlUrl: (pr.html_url as string) || "",
    }));
  } catch (err) {
    logger.error("[github] PR一覧取得エラー", err);
    return [];
  }
}

/**
 * Issueを作成
 * @param owner リポジトリオーナー
 * @param repo リポジトリ名
 * @param params Issueの内容
 */
export async function createIssue(
  owner: string,
  repo: string,
  params: { title: string; body?: string; labels?: string[] },
): Promise<GitHubIssue | null> {
  if (!isGitHubConfigured()) {
    throw new Error("GitHub not configured");
  }

  try {
    const body: Record<string, unknown> = { title: params.title };
    if (params.body) body.body = params.body;
    if (params.labels?.length) body.labels = params.labels;

    const issue = await ghPost<Record<string, unknown>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      body,
    );

    logger.debug("[github] Issue作成完了", `#${issue.number}`);

    return {
      number: issue.number as number,
      title: (issue.title as string) || "",
      state: (issue.state as string) || "",
      body: (issue.body as string) || null,
      labels: ((issue.labels as Array<{ name?: string }>) || []).map((l) => l.name || ""),
      assignees: ((issue.assignees as Array<{ login?: string }>) || []).map((a) => a.login || ""),
      createdAt: (issue.created_at as string) || "",
      updatedAt: (issue.updated_at as string) || "",
      htmlUrl: (issue.html_url as string) || "",
    };
  } catch (err) {
    logger.error("[github] Issue作成エラー", err);
    return null;
  }
}

/**
 * 未読通知を取得
 */
export async function getNotifications(): Promise<GitHubNotification[]> {
  if (!isGitHubConfigured()) {
    logger.debug("[github] GitHub未設定のためスキップ");
    return [];
  }

  try {
    const notifications = await ghGet<Array<Record<string, unknown>>>(
      "/notifications",
      { per_page: "50" },
    );

    return notifications.map((n) => {
      const subject = n.subject as Record<string, unknown> | undefined;
      const repo = n.repository as Record<string, unknown> | undefined;

      return {
        id: (n.id as string) || "",
        reason: (n.reason as string) || "",
        subject: {
          title: (subject?.title as string) || "",
          type: (subject?.type as string) || "",
          url: (subject?.url as string) || null,
        },
        repository: (repo?.full_name as string) || "",
        updatedAt: (n.updated_at as string) || "",
        unread: (n.unread as boolean) || false,
      };
    });
  } catch (err) {
    logger.error("[github] 通知取得エラー", err);
    return [];
  }
}
