import { Client } from "@notionhq/client";
import { withRetry } from "../../utils/retry";
import { TTLCache } from "../../utils/cache";
import * as logger from "../../utils/logger";

let notionClient: Client | null = null;

export function initNotion(apiKey: string): Client {
  notionClient = new Client({ auth: apiKey });
  return notionClient;
}

export function getNotion(): Client {
  if (!notionClient) throw new Error("Notion client not initialized. Call initNotion() first.");
  return notionClient;
}

const queryCache = new TTLCache<any[]>({ ttlMs: 3 * 60 * 1000, maxEntries: 50 });

export async function queryDatabase(
  databaseId: string,
  filter?: any,
  sorts?: any[],
  cacheKey?: string,
): Promise<any[]> {
  if (cacheKey) {
    const cached = queryCache.get(cacheKey);
    if (cached) return cached;
  }

  const results = await withRetry(async () => {
    const notion = getNotion();
    const response = await notion.databases.query({
      database_id: databaseId,
      filter,
      sorts,
      page_size: 100,
    });
    return response.results;
  }, { maxAttempts: 3, baseDelayMs: 1000 });

  if (cacheKey) queryCache.set(cacheKey, results);
  return results;
}

export async function createPage(
  databaseId: string,
  properties: Record<string, any>,
): Promise<string> {
  const notion = getNotion();
  const response = await withRetry(async () => {
    return notion.pages.create({
      parent: { database_id: databaseId },
      properties,
    });
  });
  return response.id;
}

export async function updatePage(
  pageId: string,
  properties: Record<string, any>,
): Promise<void> {
  const notion = getNotion();
  await withRetry(async () => {
    await notion.pages.update({ page_id: pageId, properties });
  });
}

export function invalidateCache(prefix?: string): void {
  if (prefix) {
    queryCache.invalidateByPrefix(prefix);
  } else {
    queryCache.clear();
  }
}
