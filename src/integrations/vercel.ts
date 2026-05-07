import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getConfig } from "../config";

// Vercel REST API v9連携
// Personal Access Tokenで認証

const VERCEL_API = "https://api.vercel.com";

// --- Types ---

export interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  updatedAt: string;
  latestDeploymentUrl: string | null;
}

export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: string;
  createdAt: string;
  readyAt: string | null;
  meta: Record<string, unknown> | null;
  target: string | null;
}

export interface VercelEnvVar {
  id: string;
  key: string;
  value: string;
  target: string[];
  type: string;
}

// --- Internal types ---

interface VercelApiError {
  error?: {
    code?: string;
    message?: string;
  };
}

// --- Internal helpers ---

/** Vercel設定済みか判定 */
export function isVercelConfigured(): boolean {
  const config = getConfig();
  return !!config.vercel.token;
}

/** Vercelトークンを取得 */
function getToken(): string {
  const config = getConfig();
  const token = config.vercel.token;
  if (!token) {
    throw new Error("Vercel token not configured");
  }
  return token;
}

/** Team IDを取得（オプション） */
function getTeamId(): string | undefined {
  const config = getConfig();
  return config.vercel.teamId || undefined;
}

/** クエリパラメータにteamIdを付与 */
function appendTeamId(params: URLSearchParams): URLSearchParams {
  const teamId = getTeamId();
  if (teamId) {
    params.set("teamId", teamId);
  }
  return params;
}

/** Vercel APIリクエスト共通（GET） */
async function vercelGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const token = getToken();
  const params = new URLSearchParams(query || {});
  appendTeamId(params);
  const qs = params.toString();
  const url = `${VERCEL_API}${path}${qs ? `?${qs}` : ""}`;

  return withRetry(
    async () => {
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as VercelApiError;
        throw new Error(
          `Vercel API error (${resp.status}): ${body.error?.message || resp.statusText}`,
        );
      }

      return (await resp.json()) as T;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

// --- Public API ---

/**
 * プロジェクト一覧を取得
 */
export async function getProjects(): Promise<VercelProject[]> {
  if (!isVercelConfigured()) {
    logger.debug("[vercel] Vercel未設定のためスキップ");
    return [];
  }

  try {
    const result = await vercelGet<{
      projects?: Array<Record<string, unknown>>;
    }>("/v9/projects", { limit: "100" });

    if (!result.projects) return [];

    return result.projects.map((p) => {
      const latestDeploy = p.latestDeployments as Array<Record<string, unknown>> | undefined;
      return {
        id: (p.id as string) || "",
        name: (p.name as string) || "",
        framework: (p.framework as string) || null,
        updatedAt: String(p.updatedAt || ""),
        latestDeploymentUrl: latestDeploy?.[0]?.url
          ? String(latestDeploy[0].url)
          : null,
      };
    });
  } catch (err) {
    logger.error("[vercel] プロジェクト一覧取得エラー", err);
    return [];
  }
}

/**
 * プロジェクトのデプロイメント一覧を取得
 * @param projectId プロジェクトIDまたは名前
 * @param limit 取得件数（デフォルト20）
 */
export async function getDeployments(
  projectId: string,
  limit = 20,
): Promise<VercelDeployment[]> {
  if (!isVercelConfigured()) {
    logger.debug("[vercel] Vercel未設定のためスキップ");
    return [];
  }

  try {
    const result = await vercelGet<{
      deployments?: Array<Record<string, unknown>>;
    }>("/v6/deployments", {
      projectId,
      limit: String(Math.min(limit, 100)),
    });

    if (!result.deployments) return [];

    return result.deployments.map((d) => ({
      uid: (d.uid as string) || "",
      name: (d.name as string) || "",
      url: (d.url as string) || "",
      state: (d.state as string) || (d.readyState as string) || "",
      createdAt: String(d.created || d.createdAt || ""),
      readyAt: d.ready ? String(d.ready) : null,
      meta: (d.meta as Record<string, unknown>) || null,
      target: (d.target as string) || null,
    }));
  } catch (err) {
    logger.error("[vercel] デプロイメント一覧取得エラー", err);
    return [];
  }
}

/**
 * 単一デプロイメントの詳細を取得
 * @param deploymentId デプロイメントUID
 */
export async function getDeployment(
  deploymentId: string,
): Promise<VercelDeployment | null> {
  if (!isVercelConfigured()) {
    logger.debug("[vercel] Vercel未設定のためスキップ");
    return null;
  }

  try {
    const d = await vercelGet<Record<string, unknown>>(
      `/v13/deployments/${encodeURIComponent(deploymentId)}`,
    );

    return {
      uid: (d.uid as string) || (d.id as string) || "",
      name: (d.name as string) || "",
      url: (d.url as string) || "",
      state: (d.state as string) || (d.readyState as string) || "",
      createdAt: String(d.created || d.createdAt || ""),
      readyAt: d.ready ? String(d.ready) : null,
      meta: (d.meta as Record<string, unknown>) || null,
      target: (d.target as string) || null,
    };
  } catch (err) {
    logger.error("[vercel] デプロイメント詳細取得エラー", err);
    return null;
  }
}

/**
 * プロジェクトの環境変数一覧を取得
 * @param projectId プロジェクトIDまたは名前
 */
export async function getEnvironmentVars(
  projectId: string,
): Promise<VercelEnvVar[]> {
  if (!isVercelConfigured()) {
    logger.debug("[vercel] Vercel未設定のためスキップ");
    return [];
  }

  try {
    const result = await vercelGet<{
      envs?: Array<Record<string, unknown>>;
    }>(`/v9/projects/${encodeURIComponent(projectId)}/env`);

    if (!result.envs) return [];

    return result.envs.map((e) => ({
      id: (e.id as string) || "",
      key: (e.key as string) || "",
      value: (e.value as string) || "",
      target: (e.target as string[]) || [],
      type: (e.type as string) || "",
    }));
  } catch (err) {
    logger.error("[vercel] 環境変数取得エラー", err);
    return [];
  }
}
