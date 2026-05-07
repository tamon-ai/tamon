/**
 * Webhook server for a simple dashboard API.
 * Exposes health, queue status, and a custom notification endpoint.
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=xxx WEBHOOK_PORT=3456 WEBHOOK_AUTH_TOKEN=secret \
 *     npx tsx examples/webhook-dashboard.ts
 */

import { getConfig } from "../src/config";
import { ExecutionQueue } from "../src/core/claude";
import { WebhookServer } from "../src/core/webhook";
import * as logger from "../src/utils/logger";

async function main(): Promise<void> {
  const config = getConfig();
  const queue = new ExecutionQueue(config.claude.maxConcurrent);

  const server = new WebhookServer({
    port: config.webhook.port,
    authToken: config.webhook.authToken,
  });

  server.get("/health", async (_req, res) => {
    const status = queue.getStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      uptime: process.uptime(),
      queue: status,
    }));
  });

  server.post("/notify", async (_req, res, body) => {
    const data = JSON.parse(body);
    logger.info(`[webhook] Notification received: ${data.message || "no message"}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: true }));
  });

  await server.start();
  logger.info(`[webhook] Dashboard API running on port ${config.webhook.port}`);
  logger.info(`[webhook] Try: curl http://localhost:${config.webhook.port}/health`);
}

main().catch(console.error);
