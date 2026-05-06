import { Events } from "discord.js";
import { getConfig } from "./config";
import { createClient, CommandRegistry, respond } from "./core/discord";
import { ExecutionQueue } from "./core/claude";
import { initNotion } from "./core/notion";
import { WebhookServer } from "./core/webhook";
import * as logger from "./utils/logger";

async function main(): Promise<void> {
  const config = getConfig();
  logger.info(`[tamon] Starting ${config.assistant.name}...`);

  // Initialize services
  if (config.notion.apiKey) {
    initNotion(config.notion.apiKey);
    logger.info("[tamon] Notion client initialized");
  }

  const queue = new ExecutionQueue(config.claude.maxConcurrent);
  const commands = new CommandRegistry("!");
  const client = createClient();

  // Register example command
  commands.register("status", async (message) => {
    const status = queue.getStatus();
    await message.reply(
      `**${config.assistant.name} Status**\nActive: ${status.active}/${status.maxConcurrent}\nQueued: ${status.queued}`,
    );
  });

  // Message handler
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.content.trim()) return;

    // Check commands first
    if (await commands.handle(message)) return;

    // Queue and respond
    const id = message.id;
    try {
      queue.cancelPendingForChannel(message.channelId, id);
      await queue.enqueue(id, message.channelId);
      await respond(message, {
        model: config.claude.model,
        maxExecutionMs: config.claude.maxExecutionMinutes * 60 * 1000,
      });
    } catch (err: any) {
      if (err.message !== "Cancelled by newer message") {
        logger.error("[tamon] Response error", err);
      }
    } finally {
      queue.release(id);
    }
  });

  client.on(Events.ClientReady, (c) => {
    logger.info(`[tamon] ${config.assistant.name} online as ${c.user.tag}`);
  });

  // Start webhook server
  if (config.webhook.port) {
    const webhook = new WebhookServer({
      port: config.webhook.port,
      authToken: config.webhook.authToken,
    });

    webhook.get("/health", async (_req, res) => {
      const status = queue.getStatus();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, queue: status }));
    });

    await webhook.start();
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("[tamon] Shutting down...");
    await queue.drainAndShutdown();
    client.destroy();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await client.login(config.discord.botToken);
}

main().catch((err) => {
  logger.error("[tamon] Fatal error", err);
  process.exit(1);
});
