/**
 * Gmail digest example.
 * Fetches unread emails and prints a summary.
 *
 * Usage:
 *   GOOGLE_OAUTH_CLIENT_ID=xxx GOOGLE_OAUTH_CLIENT_SECRET=xxx \
 *   GOOGLE_OAUTH_REFRESH_TOKEN=xxx DISCORD_BOT_TOKEN=xxx \
 *     npx tsx examples/gmail-digest.ts
 */

import { getConfig } from "../src/config";
import { isGoogleConfigured } from "../src/integrations/google-auth";
import { getUnreadEmails, searchEmails } from "../src/integrations/gmail";
import * as logger from "../src/utils/logger";

async function main(): Promise<void> {
  getConfig();

  if (!isGoogleConfigured()) {
    console.error("Google not configured. Set GOOGLE_OAUTH_* or GOOGLE_SA_* env vars.");
    process.exit(1);
  }

  logger.info("[digest] Fetching unread emails...");
  const unread = await getUnreadEmails(20);

  if (unread.length === 0) {
    logger.info("[digest] No unread emails.");
    return;
  }

  logger.info(`[digest] ${unread.length} unread emails:\n`);

  for (const email of unread) {
    console.log(`  From: ${email.from}`);
    console.log(`  Subject: ${email.subject}`);
    console.log(`  Date: ${email.date}`);
    console.log(`  Snippet: ${email.snippet.slice(0, 100)}`);
    console.log();
  }

  // Example: search for specific emails
  logger.info("[digest] Searching for emails with attachments...");
  const withAttachments = await searchEmails("has:attachment newer_than:7d", 5);
  logger.info(`[digest] Found ${withAttachments.length} emails with attachments.`);
}

main().catch(console.error);
