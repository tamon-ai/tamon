import * as fs from "fs";
import * as path from "path";
import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getAccessToken, isGoogleConfigured } from "./google-auth";

// Google Drive REST API v3 操作
// ファイル検索・一覧・アップロード・ダウンロードをサポート

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

const DEFAULT_FIELDS = "id,name,mimeType,modifiedTime,webViewLink,parents";
const FILE_LIST_FIELDS = `files(${DEFAULT_FIELDS}),nextPageToken`;

// --- Types ---

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  parents?: string[];
}

// --- Internal types ---

interface DriveFileListResponse {
  files?: DriveFileRaw[];
  nextPageToken?: string;
}

interface DriveFileRaw {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
}

// --- Internal helpers ---

/** Google Drive設定済みか判定（google-authに委任） */
export function isGoogleDriveConfigured(): boolean {
  return isGoogleConfigured();
}

/** Drive APIリクエスト共通 */
async function driveFetch<T>(
  urlPath: string,
  options: RequestInit = {},
  baseUrl = DRIVE_API,
): Promise<T> {
  const token = await getAccessToken();

  return withRetry(
    async () => {
      const resp = await fetch(`${baseUrl}${urlPath}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...options.headers,
        },
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Drive API error (${resp.status}): ${body}`);
      }

      // 204 No Content（DELETE等）
      if (resp.status === 204) {
        return undefined as unknown as T;
      }

      return resp.json() as Promise<T>;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/** DriveFileRawをDriveFileに変換 */
function toDriveFile(raw: DriveFileRaw): DriveFile {
  return {
    id: raw.id || "",
    name: raw.name || "(無題)",
    mimeType: raw.mimeType || "application/octet-stream",
    modifiedTime: raw.modifiedTime || "",
    webViewLink: raw.webViewLink,
    parents: raw.parents,
  };
}

// --- Public API ---

/**
 * ファイルをフルテキスト検索
 * @param query 検索クエリ（ファイル名・コンテンツを対象）
 * @param maxResults 最大件数（デフォルト20）
 */
export async function searchFiles(
  query: string,
  maxResults = 20,
): Promise<DriveFile[]> {
  if (!isGoogleDriveConfigured()) {
    logger.debug("[google-drive] Google未設定のためスキップ");
    return [];
  }

  try {
    // fullText検索クエリを構築（ゴミ箱除外）
    const q = `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: FILE_LIST_FIELDS,
      pageSize: String(Math.min(maxResults, 100)),
      orderBy: "modifiedTime desc",
    });

    const result = await driveFetch<DriveFileListResponse>(
      `/files?${params}`,
    );

    if (!result.files) return [];
    return result.files.map(toDriveFile).slice(0, maxResults);
  } catch (err) {
    logger.error("[google-drive] ファイル検索エラー", err);
    return [];
  }
}

/**
 * 最近更新されたファイルを取得
 * @param maxResults 最大件数（デフォルト20）
 */
export async function getRecentFiles(maxResults = 20): Promise<DriveFile[]> {
  if (!isGoogleDriveConfigured()) {
    logger.debug("[google-drive] Google未設定のためスキップ");
    return [];
  }

  try {
    const params = new URLSearchParams({
      q: "trashed = false",
      fields: FILE_LIST_FIELDS,
      pageSize: String(Math.min(maxResults, 100)),
      orderBy: "modifiedTime desc",
    });

    const result = await driveFetch<DriveFileListResponse>(
      `/files?${params}`,
    );

    if (!result.files) return [];
    return result.files.map(toDriveFile).slice(0, maxResults);
  } catch (err) {
    logger.error("[google-drive] 最近のファイル取得エラー", err);
    return [];
  }
}

/**
 * フォルダ内のファイル一覧を取得
 * @param folderId フォルダID
 * @param maxResults 最大件数（デフォルト50）
 */
export async function listFolder(
  folderId: string,
  maxResults = 50,
): Promise<DriveFile[]> {
  if (!isGoogleDriveConfigured()) {
    logger.debug("[google-drive] Google未設定のためスキップ");
    return [];
  }

  try {
    const allFiles: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: FILE_LIST_FIELDS,
        pageSize: String(Math.min(maxResults - allFiles.length, 100)),
        orderBy: "name",
      });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const result = await driveFetch<DriveFileListResponse>(
        `/files?${params}`,
      );

      if (result.files) {
        allFiles.push(...result.files.map(toDriveFile));
      }
      pageToken = result.nextPageToken;
    } while (pageToken && allFiles.length < maxResults);

    return allFiles.slice(0, maxResults);
  } catch (err) {
    logger.error("[google-drive] フォルダ一覧取得エラー", err);
    return [];
  }
}

/**
 * ファイルをマルチパートアップロード
 * @param localPath ローカルファイルパス
 * @param opts アップロードオプション（ファイル名、親フォルダID、MIME type）
 */
export async function uploadFile(
  localPath: string,
  opts?: { name?: string; parentId?: string; mimeType?: string },
): Promise<DriveFile | null> {
  if (!isGoogleDriveConfigured()) {
    throw new Error("Google Drive not configured");
  }

  try {
    const fileName = opts?.name || path.basename(localPath);
    const fileBuffer = fs.readFileSync(localPath);
    const fileMimeType = opts?.mimeType || "application/octet-stream";

    // マルチパートアップロード用のメタデータ
    const metadata: Record<string, unknown> = { name: fileName };
    if (opts?.parentId) {
      metadata.parents = [opts.parentId];
    }

    // multipart/related リクエストを構築
    const boundary = `tamon_upload_${Date.now()}`;
    const metadataJson = JSON.stringify(metadata);

    const bodyParts = [
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      metadataJson,
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${fileMimeType}\r\n`,
      "Content-Transfer-Encoding: base64\r\n\r\n",
      fileBuffer.toString("base64"),
      `\r\n--${boundary}--`,
    ].join("");

    const token = await getAccessToken();

    const resp = await withRetry(
      async () => {
        const r = await fetch(
          `${UPLOAD_API}/files?uploadType=multipart&fields=${DEFAULT_FIELDS}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body: bodyParts,
          },
        );

        if (!r.ok) {
          const errBody = await r.text();
          throw new Error(`Drive upload error (${r.status}): ${errBody}`);
        }

        return r.json() as Promise<DriveFileRaw>;
      },
      { maxAttempts: 3, baseDelayMs: 2000 },
    );

    logger.debug("[google-drive] ファイルアップロード完了", fileName);
    return toDriveFile(resp);
  } catch (err) {
    logger.error("[google-drive] ファイルアップロードエラー", err);
    return null;
  }
}

/**
 * ファイルをダウンロード
 * @param fileId ダウンロード対象のファイルID
 * @param destPath 保存先ローカルパス
 */
export async function downloadFile(
  fileId: string,
  destPath: string,
): Promise<void> {
  if (!isGoogleDriveConfigured()) {
    throw new Error("Google Drive not configured");
  }

  const token = await getAccessToken();

  try {
    const resp = await withRetry(
      async () => {
        const r = await fetch(
          `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!r.ok) {
          const errBody = await r.text();
          throw new Error(`Drive download error (${r.status}): ${errBody}`);
        }

        return r;
      },
      { maxAttempts: 3, baseDelayMs: 1000 },
    );

    const buffer = Buffer.from(await resp.arrayBuffer());

    // 保存先ディレクトリが存在しない場合は作成
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(destPath, buffer);
    logger.debug("[google-drive] ファイルダウンロード完了", destPath);
  } catch (err) {
    logger.error("[google-drive] ファイルダウンロードエラー", err);
    throw err;
  }
}

/**
 * ファイル配列をMarkdown形式にフォーマット
 * @param files DriveFile配列
 */
export function formatFiles(files: DriveFile[]): string {
  if (files.length === 0) return "ファイルが見つかりません。";

  const lines = files.map((f) => {
    const modified = f.modifiedTime
      ? new Date(f.modifiedTime).toLocaleDateString("ja-JP")
      : "不明";
    const link = f.webViewLink ? ` [開く](${f.webViewLink})` : "";
    return `- **${f.name}** (${f.mimeType}) — ${modified}${link}`;
  });

  return lines.join("\n");
}
