import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getConfig } from "../config";
import { getAccessToken, isGoogleConfigured } from "./google-auth";

// Google Calendar REST API操作
// freeBusy照会、イベントCRUDをサポート

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// --- Types ---

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  allDay: boolean;
  organizer?: string;
  attendees: string[];
  htmlLink?: string;
  status: string;
}

export interface CreateEventParams {
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  allDay?: boolean;
  attendees?: string[];
  timeZone?: string;
  calendarId?: string;
  userEmail?: string;
}

export interface CreatedEvent {
  id: string;
  htmlLink: string;
  summary: string;
  start: string;
  end: string;
}

export interface FreeBusySlot {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

// --- Internal types ---

interface GCalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{ email?: string; displayName?: string }>;
  htmlLink?: string;
  status?: string;
}

interface GCalEventListResponse {
  items?: GCalEvent[];
  nextPageToken?: string;
}

interface GCalFreeBusyResponse {
  calendars: Record<
    string,
    { busy: Array<{ start: string; end: string }>; errors?: unknown[] }
  >;
}

// --- Internal helpers ---

/** カレンダーAPIリクエスト共通 */
async function calendarFetch<T>(
  path: string,
  userEmail?: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken(userEmail);

  return withRetry(
    async () => {
      const resp = await fetch(`${CALENDAR_API}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Calendar API error (${resp.status}): ${body}`);
      }

      // DELETEは204 No Contentを返す
      if (resp.status === 204) {
        return undefined as unknown as T;
      }

      return resp.json() as Promise<T>;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/** GCalEventをCalendarEventに変換 */
function toCalendarEvent(event: GCalEvent): CalendarEvent {
  const allDay = !!event.start?.date;
  return {
    id: event.id,
    summary: event.summary || "(無題)",
    description: event.description,
    location: event.location,
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    allDay,
    organizer: event.organizer?.email,
    attendees: (event.attendees || [])
      .map((a) => a.email)
      .filter((e): e is string => !!e),
    htmlLink: event.htmlLink,
    status: event.status || "confirmed",
  };
}

/** デフォルトカレンダーIDの取得 */
function getCalendarId(overrideCalendarId?: string): string {
  if (overrideCalendarId) return overrideCalendarId;
  const config = getConfig();
  return config.google.calendarId || "primary";
}

// --- Public API ---

/**
 * 指定期間のカレンダーイベントを取得
 * @param params.timeMin 開始日時（ISO 8601）
 * @param params.timeMax 終了日時（ISO 8601）
 * @param params.userEmail SA委任ユーザー（省略時はデフォルト）
 */
export async function getEvents(params: {
  timeMin: string;
  timeMax: string;
  calendarId?: string;
  userEmail?: string;
}): Promise<CalendarEvent[]> {
  if (!isGoogleConfigured()) {
    logger.debug("[google-calendar] Google未設定のためスキップ");
    return [];
  }

  try {
    const calendarId = encodeURIComponent(
      getCalendarId(params.calendarId),
    );
    const query = new URLSearchParams({
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
    });

    const allEvents: CalendarEvent[] = [];
    let pageToken: string | undefined;

    // ページネーション対応
    do {
      if (pageToken) {
        query.set("pageToken", pageToken);
      }

      const result = await calendarFetch<GCalEventListResponse>(
        `/calendars/${calendarId}/events?${query}`,
        params.userEmail,
      );

      if (result.items) {
        allEvents.push(...result.items.map(toCalendarEvent));
      }
      pageToken = result.nextPageToken;
    } while (pageToken);

    return allEvents;
  } catch (err) {
    logger.error("[google-calendar] イベント取得エラー", err);
    return [];
  }
}

/**
 * カレンダーイベントを作成
 */
export async function createEvent(
  params: CreateEventParams,
): Promise<CreatedEvent> {
  if (!isGoogleConfigured()) {
    throw new Error("Google not configured");
  }

  const calendarId = encodeURIComponent(
    getCalendarId(params.calendarId),
  );
  const tz = params.timeZone || getConfig().assistant.timezone || "UTC";

  // 終日イベントとタイムスタンプイベントで形式を分ける
  const startField = params.allDay
    ? { date: params.start.split("T")[0] }
    : { dateTime: params.start, timeZone: tz };
  const endField = params.allDay
    ? { date: params.end.split("T")[0] }
    : { dateTime: params.end, timeZone: tz };

  const body: Record<string, unknown> = {
    summary: params.summary,
    start: startField,
    end: endField,
  };
  if (params.description) body.description = params.description;
  if (params.location) body.location = params.location;
  if (params.attendees && params.attendees.length > 0) {
    body.attendees = params.attendees.map((email) => ({ email }));
  }

  try {
    const event = await calendarFetch<GCalEvent>(
      `/calendars/${calendarId}/events`,
      params.userEmail,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    return {
      id: event.id,
      htmlLink: event.htmlLink || "",
      summary: event.summary || params.summary,
      start: event.start?.dateTime || event.start?.date || params.start,
      end: event.end?.dateTime || event.end?.date || params.end,
    };
  } catch (err) {
    logger.error("[google-calendar] イベント作成エラー", err);
    throw err;
  }
}

/**
 * カレンダーイベントを更新（部分更新: PATCH）
 * @param eventId 更新対象のイベントID
 * @param params 更新フィールド
 */
export async function updateEvent(
  eventId: string,
  params: Partial<CreateEventParams>,
): Promise<CreatedEvent> {
  if (!isGoogleConfigured()) {
    throw new Error("Google not configured");
  }

  const calendarId = encodeURIComponent(
    getCalendarId(params.calendarId),
  );
  const tz = params.timeZone || getConfig().assistant.timezone || "UTC";

  const body: Record<string, unknown> = {};
  if (params.summary) body.summary = params.summary;
  if (params.description !== undefined) body.description = params.description;
  if (params.location !== undefined) body.location = params.location;

  if (params.start) {
    body.start = params.allDay
      ? { date: params.start.split("T")[0] }
      : { dateTime: params.start, timeZone: tz };
  }
  if (params.end) {
    body.end = params.allDay
      ? { date: params.end.split("T")[0] }
      : { dateTime: params.end, timeZone: tz };
  }
  if (params.attendees) {
    body.attendees = params.attendees.map((email) => ({ email }));
  }

  try {
    const event = await calendarFetch<GCalEvent>(
      `/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
      params.userEmail,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    );

    return {
      id: event.id,
      htmlLink: event.htmlLink || "",
      summary: event.summary || "",
      start: event.start?.dateTime || event.start?.date || "",
      end: event.end?.dateTime || event.end?.date || "",
    };
  } catch (err) {
    logger.error("[google-calendar] イベント更新エラー", err);
    throw err;
  }
}

/**
 * カレンダーイベントを削除
 * @param eventId 削除対象のイベントID
 * @param userEmail SA委任ユーザー
 * @param calendarId カレンダーID（デフォルト: primary）
 */
export async function deleteEvent(
  eventId: string,
  userEmail?: string,
  calendarId?: string,
): Promise<void> {
  if (!isGoogleConfigured()) {
    throw new Error("Google not configured");
  }

  const calId = encodeURIComponent(getCalendarId(calendarId));

  try {
    await calendarFetch<void>(
      `/calendars/${calId}/events/${encodeURIComponent(eventId)}`,
      userEmail,
      { method: "DELETE" },
    );
    logger.debug("[google-calendar] イベント削除完了", eventId);
  } catch (err) {
    logger.error("[google-calendar] イベント削除エラー", err);
    throw err;
  }
}

/**
 * FreeBusy照会: 指定ユーザーの空き時間を取得
 * @param targetEmail 対象カレンダーのメールアドレス
 * @param timeMin 開始日時（ISO 8601）
 * @param timeMax 終了日時（ISO 8601）
 * @returns ビジー（予約済み）のスロット配列
 */
export async function getFreeBusy(
  targetEmail: string,
  timeMin: string,
  timeMax: string,
): Promise<FreeBusySlot[]> {
  if (!isGoogleConfigured()) {
    logger.debug("[google-calendar] Google未設定のためスキップ");
    return [];
  }

  try {
    const body = {
      timeMin,
      timeMax,
      items: [{ id: targetEmail }],
    };

    const result = await calendarFetch<GCalFreeBusyResponse>(
      "/freeBusy",
      undefined,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    const calendarData = result.calendars[targetEmail];
    if (!calendarData) return [];

    return calendarData.busy.map((slot) => ({
      start: slot.start,
      end: slot.end,
    }));
  } catch (err) {
    logger.error("[google-calendar] FreeBusy照会エラー", err);
    return [];
  }
}
