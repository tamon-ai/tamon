/**
 * Basic Discord bot with Claude Code.
 * The minimal setup — responds to messages using Claude.
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=xxx npx tsx examples/basic-bot.ts
 */

import { Events } from "discord.js";
import { getConfig } from "../src/config";
import { createClient, respond, CommandRegistry } from "../src/core/discord";
import { ExecutionQueue } from "../src/core/claude";
import * as logger from "../src/utils/logger";

async function main(): Promise<void> {
  const config = getConfig();
  const queue = new ExecutionQueue(config.claude.maxConcurrent);
  const commands = new CommandRegistry("!");
  const client = createClient();

  commands.register("ping", async (message) => {
    await message.reply("Pong!");
  });

  commands.register("status", async (message) => {
    const s = queue.getStatus();
    await message.reply(`Active: ${s.active}/${s.maxConcurrent} | Queued: ${s.queued}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.content.trim()) return;
    if (await commands.handle(message)) return;

    const id = message.id;
    try {
      queue.cancelPendingForChannel(message.channelId, id);
      await queue.enqueue(id, message.channelId);
      await respond(message, {
        systemPrompt: "You are a helpful assistant. Be concise.",
        model: config.claude.model,
        maxExecutionMs: config.claude.maxExecutionMinutes * 60 * 1000,
      });
    } catch (err: any) {
      if (err.message !== "Cancelled by newer message") {
        logger.error("[bot]", err);
      }
    } finally {
      queue.release(id);
    }
  });

  client.on(Events.ClientReady, (c) => {
    logger.info(`[bot] Online as ${c.user.tag}`);
  });

  await client.login(config.discord.botToken);
}

main().catch(console.error);
