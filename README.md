# TAMON

**Task Automation & Management Operations Network**

A self-hosted AI assistant framework powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Run your own AI assistant on Discord with Notion integration, webhook APIs, and extensible command handling.

## What is TAMON?

TAMON is the open-source core extracted from an AI assistant that has been running 24/7 in production for over a year. It provides the scaffolding to build a personal or team AI assistant that:

- Lives in your Discord server and responds to natural language
- Executes tasks via Claude Code (headless CLI) with streaming responses
- Manages tasks and knowledge in Notion
- Exposes a webhook API for dashboards and integrations
- Handles concurrency, retries, rate limits, and graceful shutdowns

## Architecture

```
You (Discord) ──→ TAMON (VPS)
                    ├─ Discord Bot (discord.js)
                    │   └─ Claude Code headless
                    ├─ Notion API (tasks, knowledge)
                    ├─ Webhook Server (HTTP API)
                    └─ Integrations (Gmail, Calendar, etc.)
```

## Prerequisites

- **Node.js** >= 20
- **Claude Code CLI** installed and authenticated (`claude --version`)
- **Discord Bot** token ([create one here](https://discord.com/developers/applications))
- **Notion API key** (optional, for task/knowledge management)

## Quick Start

```bash
git clone https://github.com/tamon-ai/tamon.git
cd tamon
npm install
cp .env.example .env
# Edit .env with your tokens
npm run build
npm start
```

## Configuration

All configuration is via environment variables (`.env` file):

```bash
# Required
DISCORD_BOT_TOKEN=your-discord-bot-token

# Claude
CLAUDE_MODEL=claude-sonnet-4-20250514    # or claude-opus-4-6
TAMON_MAX_CONCURRENT=2                    # parallel Claude processes
CLAUDE_MAX_EXECUTION_MINUTES=60           # max runtime per request

# Notion (optional)
NOTION_API_KEY=your-notion-api-key
NOTION_DATABASES=tasks:abc123,knowledge:def456

# Webhook (optional)
WEBHOOK_PORT=3456
WEBHOOK_AUTH_TOKEN=your-secret-token

# Assistant
TAMON_NAME=TAMON                          # your assistant's name
TZ=UTC                                    # timezone
LOG_LEVEL=info                            # debug|info|warn|error

# Channel mapping (optional)
TAMON_CHANNELS=hub:123456,tasks:789012,logs:345678
```

## Project Structure

```
src/
├── index.ts                 ← Entry point
├── config.ts                ← Environment configuration
├── core/
│   ├── claude/              ← Claude Code CLI wrapper
│   │   ├── executor.ts      ← Process spawning, streaming, timeouts
│   │   └── queue.ts         ← Concurrency control
│   ├── discord/             ← Discord bot framework
│   │   ├── client.ts        ← Client factory
│   │   ├── commands.ts      ← Command registry (!command pattern)
│   │   ├── responder.ts     ← Message → Claude → streaming reply
│   │   └── safe-send.ts     ← Rate-limit-safe message sending
│   ├── notion/              ← Notion API abstraction
│   │   └── client.ts        ← CRUD with caching & retry
│   └── webhook/             ← HTTP server
│       └── server.ts        ← Route registration, auth, CORS
└── utils/
    ├── cache.ts             ← TTL cache
    ├── fs.ts                ← Atomic file writes
    ├── logger.ts            ← Structured logging
    ├── retry.ts             ← Exponential backoff
    └── split-message.ts     ← Discord 2000-char message splitting
```

## Extending TAMON

### Custom Commands

```typescript
import { CommandRegistry } from "./core/discord";

const commands = new CommandRegistry("!");

commands.register("task", async (message, args) => {
  // Create a task in Notion
  await createPage(tasksDatabaseId, {
    Name: { title: [{ text: { content: args } }] },
  });
  await message.reply(`Task created: ${args}`);
});
```

### System Prompts

Pass a system prompt to customize your assistant's personality:

```typescript
import { respond } from "./core/discord";

await respond(message, {
  systemPrompt: `You are a helpful assistant named Atlas.
    You speak concisely and prefer bullet points.`,
  model: "claude-opus-4-6",
});
```

### Webhook Endpoints

```typescript
import { WebhookServer } from "./core/webhook";

const server = new WebhookServer({ port: 3456, authToken: "secret" });

server.post("/notify", async (req, res, body) => {
  const data = JSON.parse(body);
  // Forward notification to Discord
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
});

await server.start();
```

## Production Deployment

For production use, we recommend:

```bash
# Install pm2
npm install -g pm2

# Start with pm2
pm2 start dist/index.js --name tamon

# Auto-restart on crash
pm2 save
pm2 startup
```

## How It Works

1. **Message received** → Discord bot picks it up
2. **Command check** → If `!command`, dispatch to handler
3. **Queue** → Wait for available slot (max concurrent limit)
4. **Execute** → Spawn `claude -p` with streaming output
5. **Stream** → Real-time message updates in Discord (typing indicator + progressive edits)
6. **Complete** → Final message, reaction feedback (✅ or ⚠️)

The Claude Code CLI runs with full tool access (Read, Write, Bash, etc.), making it capable of:
- Reading and modifying code
- Running shell commands
- Searching files
- Making API calls
- Managing infrastructure

## Origin

TAMON is extracted from a production AI assistant that manages business operations for a company in Tokyo. The name means "one who hears all" (多聞) — from Tamonten (毘沙門天), the Buddhist deity of wisdom and listening.

## License

MIT — see [LICENSE](LICENSE).
