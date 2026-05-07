/**
 * Gmail digest example.
 * Fetches unread emails and prints a summary.
 *
 * Usage:
 *   npm install tamon-ai
 *   # Set GOOGLE_OAUTH_* or GOOGLE_SA_* env vars in .env
 *   npx tsx gmail-digest.ts
 */

import {
  getConfig,
  isGoogleConfigured,
  getUnreadEmails,
  searchEmails,
  logger,
} from "tamon-ai";

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

  logger.info("[digest] Searching for emails with attachments...");
  const withAttachments = await searchEmails("has:attachment newer_than:7d", 5);
  logger.info(`[digest] Found ${withAttachments.length} emails with attachments.`);
}

main().catch(console.error);
