import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getConfig } from "../config";

// Supabase連携
// PostgREST（CRUD）+ Management API（raw SQL）

// --- Types ---

/** PostgRESTフィルタ演算子 */
type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "in"
  | "is";

export interface QueryParams {
  select?: string;
  filter?: Record<string, { op: FilterOperator; value: unknown }>;
  order?: string;
  limit?: number;
}

// --- Internal types ---

interface PostgrestErrorResponse {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

interface ManagementSqlResponse {
  result?: Array<Record<string, unknown>>;
  error?: string;
}

// --- 設定チェック ---

/** Supabase設定済みか判定 */
export function isSupabaseConfigured(): boolean {
  const config = getConfig();
  return !!(config.supabase?.url && config.supabase?.serviceRoleKey);
}

// --- Internal helpers ---

/** PostgRESTのベースURL */
function getPostgrestUrl(): string {
  const config = getConfig();
  const url = config.supabase?.url;
  if (!url) throw new Error("Supabase URL not configured");
  // 末尾スラッシュ除去
  return `${url.replace(/\/+$/, "")}/rest/v1`;
}

/** PostgRESTリクエスト用ヘッダー */
function getPostgrestHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const config = getConfig();
  const key = config.supabase?.serviceRoleKey;
  if (!key) throw new Error("Supabase service role key not configured");

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Management APIのベースURL */
const MANAGEMENT_API = "https://api.supabase.com/v1";

/** Management APIリクエスト用ヘッダー */
function getManagementHeaders(): Record<string, string> {
  const config = getConfig();
  const token = config.supabase?.managementToken;
  if (!token) throw new Error("Supabase management token not configured");

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * フィルタパラメータをURLSearchParamsに変換
 * PostgREST形式: column=op.value
 */
function applyFilters(
  searchParams: URLSearchParams,
  filter: Record<string, { op: FilterOperator; value: unknown }>,
): void {
  for (const [column, { op, value }] of Object.entries(filter)) {
    let formatted: string;

    if (op === "in") {
      // in演算子: column=in.(val1,val2,val3)
      const values = Array.isArray(value) ? value : [value];
      formatted = `in.(${values.map(String).join(",")})`;
    } else if (op === "is") {
      // is演算子: null/true/false判定
      formatted = `is.${value}`;
    } else {
      formatted = `${op}.${value}`;
    }

    searchParams.set(column, formatted);
  }
}

/**
 * PostgREST APIリクエスト共通
 * レスポンスのContent-Typeに応じてJSONまたは空を返す
 */
async function postgrestFetch<T>(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    searchParams?: URLSearchParams;
  } = {},
): Promise<T> {
  const { method = "GET", headers = {}, body, searchParams } = options;
  const baseUrl = getPostgrestUrl();
  const url = new URL(`${baseUrl}/${path}`);

  if (searchParams) {
    searchParams.forEach((value, key) => url.searchParams.set(key, value));
  }

  return withRetry(
    async () => {
      const resp = await fetch(url.toString(), {
        method,
        headers: getPostgrestHeaders(headers),
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!resp.ok) {
        const errorBody = await resp.text();
        let errorMessage = `PostgREST HTTP error (${resp.status})`;
        try {
          const parsed = JSON.parse(errorBody) as PostgrestErrorResponse;
          if (parsed.message) {
            errorMessage += `: ${parsed.message}`;
          }
          if (parsed.hint) {
            errorMessage += ` (hint: ${parsed.hint})`;
          }
        } catch {
          if (errorBody) errorMessage += `: ${errorBody}`;
        }
        throw new Error(errorMessage);
      }

      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return (await resp.json()) as T;
      }

      // 空レスポンス（DELETEなど）
      return [] as unknown as T;
    },
    { maxAttempts: 3, baseDelayMs: 500 },
  );
}

// --- Public API ---

/**
 * テーブルからレコードを取得（PostgREST GET）
 * @param table テーブル名
 * @param params クエリパラメータ（select, filter, order, limit）
 */
export async function query<T = Record<string, unknown>>(
  table: string,
  params?: QueryParams,
): Promise<T[]> {
  if (!isSupabaseConfigured()) {
    logger.debug("[supabase] Supabase未設定のためスキップ");
    return [];
  }

  try {
    const searchParams = new URLSearchParams();

    if (params?.select) {
      searchParams.set("select", params.select);
    }
    if (params?.filter) {
      applyFilters(searchParams, params.filter);
    }
    if (params?.order) {
      searchParams.set("order", params.order);
    }
    if (params?.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }

    const result = await postgrestFetch<T[]>(table, { searchParams });
    logger.debug("[supabase] クエリ完了", table, `${result.length}件`);
    return result;
  } catch (err) {
    logger.error("[supabase] クエリエラー", table, err);
    return [];
  }
}

/**
 * テーブルにレコードを挿入（PostgREST POST）
 * @param table テーブル名
 * @param data 挿入するデータ
 * @returns 挿入されたレコード（Prefer: return=representationで取得）
 */
export async function insert<T = Record<string, unknown>>(
  table: string,
  data: Record<string, unknown>,
): Promise<T | null> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase not configured");
  }

  try {
    const result = await postgrestFetch<T[]>(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: data,
    });

    const inserted = Array.isArray(result) ? result[0] ?? null : null;
    logger.debug("[supabase] 挿入完了", table);
    return inserted;
  } catch (err) {
    logger.error("[supabase] 挿入エラー", table, err);
    return null;
  }
}

/**
 * テーブルのレコードを更新（PostgREST PATCH）
 * @param table テーブル名
 * @param match 更新対象を特定するフィルタ（eq条件のみ）
 * @param data 更新するデータ
 */
export async function update(
  table: string,
  match: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase not configured");
  }

  try {
    const searchParams = new URLSearchParams();
    for (const [column, value] of Object.entries(match)) {
      searchParams.set(column, `eq.${value}`);
    }

    await postgrestFetch(table, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: data,
      searchParams,
    });

    logger.debug("[supabase] 更新完了", table);
    return true;
  } catch (err) {
    logger.error("[supabase] 更新エラー", table, err);
    return false;
  }
}

/**
 * テーブルからレコードを削除（PostgREST DELETE）
 * @param table テーブル名
 * @param match 削除対象を特定するフィルタ（eq条件のみ）
 */
export async function deleteRows(
  table: string,
  match: Record<string, unknown>,
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase not configured");
  }

  if (Object.keys(match).length === 0) {
    logger.error("[supabase] 削除フィルタが空のため拒否（全行削除防止）", table);
    return false;
  }

  try {
    const searchParams = new URLSearchParams();
    for (const [column, value] of Object.entries(match)) {
      searchParams.set(column, `eq.${value}`);
    }

    await postgrestFetch(table, {
      method: "DELETE",
      searchParams,
    });

    logger.debug("[supabase] 削除完了", table);
    return true;
  } catch (err) {
    logger.error("[supabase] 削除エラー", table, err);
    return false;
  }
}

/**
 * PostgreSQL関数（RPC）を呼び出し
 * @param functionName 関数名
 * @param params 関数パラメータ
 */
export async function rpc<T = unknown>(
  functionName: string,
  params?: Record<string, unknown>,
): Promise<T | null> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase not configured");
  }

  try {
    const result = await postgrestFetch<T>(`rpc/${functionName}`, {
      method: "POST",
      body: params || {},
    });

    logger.debug("[supabase] RPC呼び出し完了", functionName);
    return result;
  } catch (err) {
    logger.error("[supabase] RPC呼び出しエラー", functionName, err);
    return null;
  }
}

/**
 * Management API経由でraw SQLを実行
 * supabase.managementToken が必要
 * @param queryStr SQLクエリ
 */
export async function sql<T = Record<string, unknown>>(
  queryStr: string,
): Promise<T[]> {
  const config = getConfig();

  if (!config.supabase?.managementToken) {
    throw new Error("Supabase management token not configured");
  }

  // URLからプロジェクトrefを抽出（https://<ref>.supabase.co）
  const url = config.supabase?.url;
  if (!url) throw new Error("Supabase URL not configured");

  const refMatch = url.match(/https:\/\/([^.]+)\.supabase\./);
  if (!refMatch) {
    throw new Error(
      `Cannot extract project ref from URL: ${url}. Expected format: https://<ref>.supabase.co`,
    );
  }
  const projectRef = refMatch[1];

  try {
    const result = await withRetry(
      async () => {
        const resp = await fetch(
          `${MANAGEMENT_API}/projects/${projectRef}/database/query`,
          {
            method: "POST",
            headers: getManagementHeaders(),
            body: JSON.stringify({ query: queryStr }),
          },
        );

        if (!resp.ok) {
          const errorBody = await resp.text();
          throw new Error(
            `Management API HTTP error (${resp.status}): ${errorBody}`,
          );
        }

        return (await resp.json()) as ManagementSqlResponse;
      },
      { maxAttempts: 3, baseDelayMs: 1000 },
    );

    if (result.error) {
      throw new Error(`SQL execution error: ${result.error}`);
    }

    logger.debug("[supabase] SQL実行完了");
    return (result.result as T[]) || [];
  } catch (err) {
    logger.error("[supabase] SQL実行エラー", err);
    return [];
  }
}
