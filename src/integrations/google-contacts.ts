import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getAccessToken, isGoogleConfigured } from "./google-auth";

// Google People API v1 操作
// 連絡先の検索・一覧・取得・作成をサポート

const PEOPLE_API = "https://people.googleapis.com/v1";

// 取得するフィールドマスク
const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations,photos";

// --- Types ---

export interface Contact {
  resourceName: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  photoUrl?: string;
}

// --- Internal types ---

interface PersonResource {
  resourceName?: string;
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
  emailAddresses?: Array<{ value?: string; type?: string }>;
  phoneNumbers?: Array<{ value?: string; type?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
  photos?: Array<{ url?: string }>;
}

interface PeopleListResponse {
  connections?: PersonResource[];
  totalItems?: number;
  nextPageToken?: string;
}

interface PeopleSearchResponse {
  results?: Array<{ person?: PersonResource }>;
  totalSize?: number;
}

// --- Internal helpers ---

/** Contacts（People API）設定済みか判定 */
export function isContactsConfigured(): boolean {
  return isGoogleConfigured();
}

/** People APIリクエスト共通 */
async function peopleFetch<T>(
  urlPath: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();

  return withRetry(
    async () => {
      const resp = await fetch(`${PEOPLE_API}${urlPath}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`People API error (${resp.status}): ${body}`);
      }

      if (resp.status === 204) {
        return undefined as unknown as T;
      }

      return resp.json() as Promise<T>;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/** PersonResourceをContactに変換 */
function toContact(person: PersonResource): Contact {
  const name =
    person.names?.[0]?.displayName ||
    [person.names?.[0]?.givenName, person.names?.[0]?.familyName]
      .filter(Boolean)
      .join(" ") ||
    "(名前なし)";

  return {
    resourceName: person.resourceName || "",
    name,
    email: person.emailAddresses?.[0]?.value,
    phone: person.phoneNumbers?.[0]?.value,
    organization: person.organizations?.[0]?.name,
    photoUrl: person.photos?.[0]?.url,
  };
}

// --- Public API ---

/**
 * 連絡先を名前・メールアドレスで検索
 * @param query 検索クエリ
 * @param maxResults 最大件数（デフォルト10）
 */
export async function searchContacts(
  query: string,
  maxResults = 10,
): Promise<Contact[]> {
  if (!isContactsConfigured()) {
    logger.debug("[google-contacts] Google未設定のためスキップ");
    return [];
  }

  try {
    const params = new URLSearchParams({
      query,
      readMask: PERSON_FIELDS,
      pageSize: String(Math.min(maxResults, 30)),
    });

    const result = await peopleFetch<PeopleSearchResponse>(
      `/people:searchContacts?${params}`,
    );

    if (!result.results) return [];

    return result.results
      .filter((r) => r.person)
      .map((r) => toContact(r.person!))
      .slice(0, maxResults);
  } catch (err) {
    logger.error("[google-contacts] 連絡先検索エラー", err);
    return [];
  }
}

/**
 * 全連絡先を一覧取得
 * @param maxResults 最大件数（デフォルト100）
 */
export async function listContacts(maxResults = 100): Promise<Contact[]> {
  if (!isContactsConfigured()) {
    logger.debug("[google-contacts] Google未設定のためスキップ");
    return [];
  }

  try {
    const allContacts: Contact[] = [];
    let pageToken: string | undefined;

    // ページネーション対応
    do {
      const params = new URLSearchParams({
        personFields: PERSON_FIELDS,
        pageSize: String(Math.min(maxResults - allContacts.length, 100)),
        sortOrder: "FIRST_NAME_ASCENDING",
      });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const result = await peopleFetch<PeopleListResponse>(
        `/people/me/connections?${params}`,
      );

      if (result.connections) {
        allContacts.push(...result.connections.map(toContact));
      }
      pageToken = result.nextPageToken;
    } while (pageToken && allContacts.length < maxResults);

    return allContacts.slice(0, maxResults);
  } catch (err) {
    logger.error("[google-contacts] 連絡先一覧取得エラー", err);
    return [];
  }
}

/**
 * 単一の連絡先を取得
 * @param resourceName リソース名（例: "people/c1234567890"）
 */
export async function getContact(
  resourceName: string,
): Promise<Contact | null> {
  if (!isContactsConfigured()) {
    logger.debug("[google-contacts] Google未設定のためスキップ");
    return null;
  }

  try {
    const params = new URLSearchParams({
      personFields: PERSON_FIELDS,
    });

    const person = await peopleFetch<PersonResource>(
      `/${resourceName}?${params}`,
    );

    return toContact(person);
  } catch (err) {
    logger.error("[google-contacts] 連絡先取得エラー", err);
    return null;
  }
}

/**
 * 新しい連絡先を作成
 * @param params 連絡先情報（名前は必須）
 */
export async function createContact(params: {
  name: string;
  email?: string;
  phone?: string;
  org?: string;
}): Promise<Contact | null> {
  if (!isContactsConfigured()) {
    throw new Error("Google Contacts not configured");
  }

  try {
    // People API createContact リクエストボディを構築
    const body: Record<string, unknown> = {
      names: [{ givenName: params.name }],
    };

    if (params.email) {
      body.emailAddresses = [{ value: params.email }];
    }
    if (params.phone) {
      body.phoneNumbers = [{ value: params.phone }];
    }
    if (params.org) {
      body.organizations = [{ name: params.org }];
    }

    const person = await peopleFetch<PersonResource>(
      `/people:createContact`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    logger.debug("[google-contacts] 連絡先作成完了", params.name);
    return toContact(person);
  } catch (err) {
    logger.error("[google-contacts] 連絡先作成エラー", err);
    return null;
  }
}
