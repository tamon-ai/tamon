# Webhook API

TAMON includes a built-in HTTP server for dashboards and external integrations.

## Setup

```typescript
import { WebhookServer } from "tamon-ai";

const server = new WebhookServer({ port: 3456, authToken: "secret" });

server.get("/health", async (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

server.post("/notify", async (req, res, body) => {
  const data = JSON.parse(body);
  // Forward to Discord, etc.
  res.writeHead(200);
  res.end(JSON.stringify({ received: true }));
});

await server.start();
```
