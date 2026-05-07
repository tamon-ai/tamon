<p align="center">
  <h1 align="center">TAMON</h1>
  <p align="center">
    <strong>Your AI assistant that actually does things.</strong>
    <br />
    Not a chatbot. A self-hosted AI agent that manages your tasks, reads your email, checks your calendar, and works while you sleep.
  </p>
  <p align="center">
    <a href="#quick-start">Quick Start</a> &bull;
    <a href="docs/">Documentation</a> &bull;
    <a href="examples/">Examples</a> &bull;
    <a href="CONTRIBUTING.md">Contributing</a>
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-green.svg" alt="Node.js >= 20" /></a>
    <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Powered%20by-Claude%20Code-purple.svg" alt="Claude Code" /></a>
  </p>
</p>

---

```
You:    What meetings do I have tomorrow?
TAMON:  You have 3 meetings tomorrow:
          10:00  Team standup (Google Meet)
          14:00  Client review — Acme Corp
          17:00  1:1 with Alice
        Want me to block focus time around them?

You:    Yeah, and draft a prep email for the Acme review
TAMON:  Done. 90-min focus block added before Acme (12:30-14:00).
        Draft ready — pulled last 3 email threads with Acme for context.
        Review it in Gmail?

You:    !task Prepare slide deck for Acme review due:tomorrow 13:00
TAMON:  Created in Notion — "Prepare slide deck for Acme review"
        Due: Jan 15, 13:00. Priority: High (meeting in <24h).
```

## Why another agent framework?

Short answer: this one isn't a wrapper around an LLM API.

Most frameworks work like this: define tool schemas → send them to the API → hope the model picks the right one → parse the response → call your function. You're building the agent's hands out of JSON schemas.

**TAMON spawns [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI processes.** The AI gets a shell session — filesystem, git, curl, databases, package managers — the same tools a developer has. No tool schemas to maintain, no function routing to debug.

```
Typical framework:   LLM API  →  tool schema matching  →  predefined function  →  response
TAMON:               Claude Code process (with shell)   →  does whatever is needed →  streams back
```

This means:
- **Install `ffmpeg` on the server** and the AI can process video. No integration code to write.
- **Need to query a database?** It runs `psql`. No ORM wrapper required.
- **Bug in your code?** It reads the file, edits it, runs the tests, commits the fix.

The tradeoff: each process is stateless. TAMON compensates with **identity injection** — every invocation gets a fully assembled prompt containing personality, context, integration status, and conversation history. Deterministic context, not degrading windows.

> **Built from production.** TAMON's core was extracted from an AI assistant running 24/7 in production — managing tasks, email, calendar, team coordination, and autonomous workflows. The safety mechanisms (circuit breakers, activity gates, process isolation) exist because we hit every failure mode and had to solve them.

**[Read the full architecture doc →](docs/architecture.md)**

## Quick Start

```bash
git clone https://github.com/tamon-ai/tamon.git && cd tamon
npm install
cp .env.example .env   # add your Discord bot token
npm run build && npm start
```

Three things you need:
1. **Node.js 20+**
2. **Claude Code CLI** — [install guide](https://docs.anthropic.com/en/docs/claude-code)
3. **Discord Bot token** — [create one here](https://discord.com/developers/applications)

That's it. Talk to your bot on Discord.

## Features

### Talk naturally, or use commands

TAMON understands natural language. No slash-command memorization required.

For power users, register custom `!commands`:

```typescript
import { CommandRegistry } from "@tamon-ai/core/core/discord";

const commands = new CommandRegistry("!");
commands.register("deploy", async (msg) => { /* your logic */ });
```

### Give it a personality

```typescript
await respond(message, {
  systemPrompt: `You are Atlas, a concise technical assistant.
    Never use emojis. Always suggest the simplest solution first.`,
  model: "claude-opus-4-6",
});
```

### Connect your tools

All integrations are opt-in. Add credentials to `.env` and they light up automatically.

| Integration | Capabilities |
|---|---|
| **Gmail** | Read, search, draft, reply |
| **Google Calendar** | Events, scheduling, free/busy |
| **Slack** | Messages, search, file sharing |
| **Telegram** | Bot messaging |
| **Notion** | Tasks, knowledge base, notes |
| **Webhook API** | Custom HTTP endpoints |

See [docs/integrations.md](docs/integrations.md) for code examples.

### Autonomous task execution

TAMON doesn't just respond — it works on its own. Score tasks by priority, execute them via Claude, track results.

```typescript
const executor = new TaskExecutor({
  taskSource: new NotionTaskSource("your-db-id"),
  scorer: defaultScorer,
  evaluator: defaultEvaluator,
  maxConcurrent: 2,
});

await executor.run(); // scores, picks, executes, reports
```

The activity gate ensures it won't interrupt you mid-conversation.

See [docs/autonomy.md](docs/autonomy.md) for the full API.

## Architecture

```
You (Discord) ──> TAMON (your server)
                    |
                    +-- Discord Bot (discord.js)
                    |     \-- Claude Code headless (streaming)
                    |
                    +-- Queue (semaphore, default max 2 concurrent)
                    |
                    +-- Notion (tasks, knowledge, persistent memory)
                    |
                    +-- Integrations (opt-in via env vars)
                    |     +-- Gmail, Google Calendar
                    |     +-- Slack, Telegram
                    |     \-- Webhook API
                    |
                    \-- Autonomy Engine
                          +-- Task scoring & execution
                          +-- Activity gate (won't interrupt conversations)
                          \-- Circuit breaker (max 2 failures/day per task)
```

**How a message flows:**

1. Message arrives → queue checks concurrency slots
2. Identity assembled (personality + integration status + channel context)
3. Claude Code CLI spawned as child process with full shell access
4. Response streamed back to Discord in real-time (1.5s update interval)
5. Process tree cleaned up, queue slot released, next message promoted

**How autonomy works:**

1. Cron triggers task cycle → activity gate checks all channels are idle (5min cooldown)
2. Tasks fetched and scored (priority × due date proximity × staleness)
3. Top tasks executed concurrently via Claude Code
4. Results evaluated → done / needs-review / retry (with failure limit)

Each piece is a single file with a clear interface. [Full architecture deep-dive →](docs/architecture.md)

## Deploy to production

```bash
npm install -g pm2
pm2 start dist/index.js --name tamon
pm2 save && pm2 startup
```

**Recommended**: 2 CPU / 4GB RAM, Ubuntu 22.04+, Node 20 LTS.

See [docs/configuration.md](docs/configuration.md) for all environment variables.

## Examples

| Example | Description |
|---|---|
| [basic-bot.ts](examples/basic-bot.ts) | Minimal Discord bot with Claude — ~50 lines |
| [gmail-digest.ts](examples/gmail-digest.ts) | Daily email summary sent to Discord |
| [autonomous-tasks.ts](examples/autonomous-tasks.ts) | Self-running task executor with Notion |
| [webhook-dashboard.ts](examples/webhook-dashboard.ts) | HTTP API for external dashboards |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
