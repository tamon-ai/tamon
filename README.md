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

## What makes TAMON different

Most AI assistant frameworks give you a chatbot. TAMON gives you an **agent** — one that connects to your actual tools and works autonomously.

| | Chatbots | TAMON |
|---|---|---|
| Remembers context | Session only | Persistent (Notion) |
| Takes action | "Here's how you could..." | Actually does it |
| Works when you're away | No | Yes — autonomous task execution |
| Connects to your tools | Via plugins | Native (Gmail, Calendar, Slack, Telegram) |
| Runs on your infra | Cloud vendor lock-in | Self-hosted, you own everything |

**Built from production, not theory.** TAMON's core was extracted from an AI assistant that runs 24/7 managing real business operations — tasks, email, calendar, team coordination, and autonomous workflows. This isn't a weekend prototype; it's battle-tested infrastructure.

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
                    +-- Notion (tasks, knowledge)
                    |
                    +-- Integrations
                    |     +-- Gmail
                    |     +-- Google Calendar
                    |     +-- Slack
                    |     \-- Telegram
                    |
                    +-- Autonomy Engine
                    |     +-- Task scoring & execution
                    |     \-- Activity gate
                    |
                    \-- Webhook Server (HTTP API)
```

## How it works

1. **Message arrives** on Discord
2. **Queue** manages concurrency (configurable parallel Claude processes)
3. **Claude Code** executes with full tool access — reads files, runs commands, calls APIs
4. **Streams** the response back to Discord in real-time
5. **Autonomous mode** kicks in when you're idle — picks tasks, executes, reports back

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
