# TAMON

**Task Automation & Management Operations Network**

A self-hosted AI assistant framework powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Run your own AI assistant on Discord with Notion integration, autonomous task execution, and extensible connectors.

> The name means "one who hears all" (多聞) — from Tamonten (毘沙門天), the Buddhist deity of wisdom and listening.

## What is TAMON?

TAMON is the open-source core extracted from an AI assistant that has been running 24/7 in production for over a year. It provides the scaffolding to build a personal or team AI assistant that:

- **Lives in Discord** — responds to natural language and `!commands`
- **Thinks with Claude** — executes tasks via Claude Code headless CLI with streaming
- **Remembers in Notion** — manages tasks, knowledge, and notes
- **Connects everything** — Gmail, Google Calendar, Slack, Telegram out of the box
- **Works autonomously** — scores, prioritizes, and executes tasks on its own
- **Exposes an API** — webhook server for dashboards and external integrations

## Architecture

```
You (Discord) ──→ TAMON (VPS / server)
                    ├─ Discord Bot (discord.js)
                    │   └─ Claude Code headless
                    ├─ Notion API (tasks, knowledge)
                    ├─ Integrations
                    │   ├─ Gmail (read, search, draft)
                    │   ├─ Google Calendar (CRUD, free/busy)
                    │   ├─ Slack (messages, search, files)
                    │   └─ Telegram (messages, updates)
                    ├─ Autonomy Engine
                    │   ├─ Task Executor (score → execute → evaluate)
                    │   └─ Task Preparator (analyze → prep → notify)
                    └─ Webhook Server (HTTP API)
```

## Quick Start

```bash
git clone https://github.com/tamon-ai/tamon.git
cd tamon
npm install
cp .env.example .env
# Edit .env with your Discord bot token (minimum requirement)
npm run build
npm start
```

### Prerequisites

- **Node.js** >= 20
- **Claude Code CLI** installed and authenticated ([install guide](https://docs.anthropic.com/en/docs/claude-code))
- **Discord Bot** token ([create one](https://discord.com/developers/applications))

### Optional services

| Service | What it enables | Config keys |
|---------|----------------|-------------|
| Notion | Task management, knowledge base | `NOTION_API_KEY`, `NOTION_DATABASES` |
| Google Workspace | Gmail + Calendar integration | `GOOGLE_SA_KEY_FILE` or `GOOGLE_OAUTH_*` |
| Slack | Cross-platform messaging | `SLACK_BOT_TOKEN` |
| Telegram | Telegram bot messaging | `TELEGRAM_BOT_TOKEN` |

All integrations are opt-in. TAMON runs with just a Discord token.

## Configuration

All configuration is via environment variables (`.env` file). See [.env.example](.env.example) for the full list.

```bash
# Core (required)
DISCORD_BOT_TOKEN=your-token

# Claude
CLAUDE_MODEL=claude-sonnet-4-20250514    # or claude-opus-4-6
TAMON_MAX_CONCURRENT=2                    # parallel Claude processes
CLAUDE_MAX_EXECUTION_MINUTES=60           # timeout per request

# Assistant personality
TAMON_NAME=TAMON
TZ=UTC
```

## Usage

### Discord Commands

TAMON responds to natural language by default. Prefix commands with `!`:

```
!status          → Show queue status and active processes
!task Do X by Y  → Create a task (with Notion integration)
```

Register custom commands:

```typescript
import { CommandRegistry } from "@tamon-ai/core/core/discord";

const commands = new CommandRegistry("!");
commands.register("ping", async (message) => {
  await message.reply("Pong!");
});
```

### System Prompts

Customize your assistant's personality:

```typescript
import { respond } from "@tamon-ai/core/core/discord";

await respond(message, {
  systemPrompt: `You are Atlas, a concise technical assistant.
    You prefer bullet points and speak in the third person.`,
  model: "claude-opus-4-6",
});
```

## Integrations

All integrations are optional and auto-detected on startup. TAMON logs which ones are available:

```
[tamon] Integrations available: Google (Gmail/Calendar/Drive), Slack
```

### Gmail

```typescript
import { getUnreadEmails, searchEmails, createDraft, getThread } from "@tamon-ai/core/integrations";

// Get unread emails from last 24h
const unread = await getUnreadEmails(10);

// Search with Gmail query syntax
const results = await searchEmails("from:boss@company.com subject:urgent");

// Read a full thread
const thread = await getThread(results[0].threadId);

// Create a reply draft
const draftUrl = await createDraft(
  "boss@company.com",
  "Re: Urgent",
  "On it.",
  results[0].threadId,
);
```

### Google Calendar

```typescript
import { getEvents, createEvent, getFreeBusy } from "@tamon-ai/core/integrations";

// Today's events
const now = new Date();
const events = await getEvents({
  timeMin: now.toISOString(),
  timeMax: new Date(now.getTime() + 86400000).toISOString(),
});

// Create an event with attendees
const created = await createEvent({
  summary: "Team standup",
  start: "2026-01-15T10:00:00+09:00",
  end: "2026-01-15T10:30:00+09:00",
  attendees: ["alice@company.com", "bob@company.com"],
});

// Check availability
const busy = await getFreeBusy(
  "alice@company.com",
  "2026-01-15T09:00:00Z",
  "2026-01-15T18:00:00Z",
);
```

### Slack

```typescript
import { sendMessage, searchMessages, getChannelHistory } from "@tamon-ai/core/integrations";

await sendMessage("#general", "Hello from TAMON!");
const history = await getChannelHistory("C01234567", 50);
const results = await searchMessages("deployment failed");
```

### Telegram

```typescript
import { sendMessage, getUpdates, getMe } from "@tamon-ai/core/integrations";

const bot = await getMe();
console.log(`Bot: ${bot.firstName} (@${bot.username})`);

await sendMessage("123456789", "Hello from TAMON!");
const updates = await getUpdates();
```

## Autonomous Task Execution

TAMON can execute tasks autonomously — scoring them by priority and due date, running them via Claude, and tracking results.

### Setup

```typescript
import { TaskExecutor, NotionTaskSource, defaultScorer, defaultEvaluator } from "@tamon-ai/core/autonomy";

const source = new NotionTaskSource("your-tasks-database-id");

const executor = new TaskExecutor({
  taskSource: source,
  scorer: defaultScorer,
  evaluator: defaultEvaluator,
  maxConcurrent: 2,
  maxFailuresPerDay: 2,
  systemPrompt: "You are a task execution agent. Complete tasks efficiently.",

  onTaskComplete: async (task, result) => {
    console.log(`✅ ${task.title}: ${result.slice(0, 100)}`);
  },
  onTaskFailed: async (task, error) => {
    console.log(`❌ ${task.title}: ${error}`);
  },
  onReviewNeeded: async (task, result) => {
    console.log(`👀 ${task.title} needs review`);
  },
});

// Run one cycle (call this from a cron or scheduler)
await executor.run();
```

### Task Scoring

The default scorer prioritizes tasks by:

| Factor | Points |
|--------|--------|
| Overdue | 100 + (days overdue × 10) |
| High priority | +50 |
| Medium priority | +20 |
| Due within 24h | +30 |
| Due within 3 days | +15 |
| No due date | +5 |

Provide your own scorer:

```typescript
const myScorer = (task: Task) => {
  if (task.owner === "bot") return 200;
  return defaultScorer(task);
};
```

### Task Preparation

Two-phase task preparation: analyze what can be automated, then execute prep work.

```typescript
import { TaskPreparator, NotionTaskSource } from "@tamon-ai/core/autonomy";

const preparator = new TaskPreparator({
  taskSource: new NotionTaskSource("your-db-id"),
  onPrepComplete: async (task, analysis, result) => {
    console.log(`Prepared: ${task.title}`);
    console.log(`Human actions needed: ${analysis.requiresHuman.join(", ")}`);
  },
});

await preparator.run();
```

### Activity Gate

Prevents autonomous execution from interrupting active user conversations:

```typescript
import { registerActivity, canRunAutonomousTasks, setGate } from "@tamon-ai/core/autonomy";

// Call on every user message
registerActivity(message.channelId);

// Check before running autonomous tasks
const { allowed, reason } = canRunAutonomousTasks();
if (!allowed) {
  console.log(`Skipping: ${reason}`);
}

// Manual override
setGate(false);  // Block autonomous tasks
setGate(null);   // Return to auto mode
```

### Custom Task Source

Implement the `TaskSource` interface for any backend:

```typescript
import { TaskSource, Task } from "@tamon-ai/core/autonomy";

class MyTaskSource implements TaskSource {
  async fetchTasks(): Promise<Task[]> {
    // Fetch from your database, API, etc.
    return [
      {
        id: "1",
        title: "Deploy new feature",
        status: "pending",
        priority: "high",
        dueDate: "2026-01-20",
        executionType: "auto",
      },
    ];
  }

  async updateStatus(taskId: string, status: Task["status"]): Promise<void> {
    // Update in your backend
  }

  async addNote(taskId: string, note: string): Promise<void> {
    // Append note to task
  }
}
```

## Webhook API

```typescript
import { WebhookServer } from "@tamon-ai/core/core/webhook";

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

## Production Deployment

```bash
npm install -g pm2
pm2 start dist/index.js --name tamon
pm2 save
pm2 startup
```

### Recommended setup

- **VPS**: 2 CPU / 4GB RAM minimum (Claude Code processes are memory-hungry)
- **OS**: Ubuntu 22.04+ or Debian 12+
- **Node**: 20 LTS via nvm
- **Process manager**: pm2 with auto-restart

## Project Structure

```
src/
├── index.ts                     ← Entry point
├── config.ts                    ← Environment configuration
├── core/
│   ├── claude/                  ← Claude Code CLI wrapper
│   │   ├── executor.ts          ← Process spawning, streaming, timeouts
│   │   └── queue.ts             ← Concurrency control
│   ├── discord/                 ← Discord bot framework
│   │   ├── client.ts            ← Client factory
│   │   ├── commands.ts          ← Command registry (!command)
│   │   ├── responder.ts         ← Message → Claude → streaming reply
│   │   └── safe-send.ts         ← Rate-limit-safe message sending
│   ├── notion/                  ← Notion API abstraction
│   │   └── client.ts            ← CRUD with caching & retry
│   └── webhook/                 ← HTTP server
│       └── server.ts            ← Route registration, auth, CORS
├── integrations/                ← External service connectors
│   ├── google-auth.ts           ← SA + OAuth dual-mode auth
│   ├── gmail.ts                 ← Email read/search/draft
│   ├── google-calendar.ts       ← Calendar CRUD + free/busy
│   ├── slack.ts                 ← Messaging, search, file upload
│   └── telegram.ts             ← Bot API messaging
├── autonomy/                    ← Autonomous task execution
│   ├── types.ts                 ← Core type definitions
│   ├── task-executor.ts         ← Score → execute → evaluate loop
│   ├── task-preparation.ts      ← Two-phase task preparation
│   ├── activity-gate.ts         ← User activity detection
│   ├── task-scorer.ts           ← Priority scoring algorithm
│   ├── result-evaluator.ts      ← Outcome classification
│   └── notion-task-source.ts    ← Notion-backed task source
└── utils/
    ├── cache.ts                 ← TTL cache
    ├── fs.ts                    ← Atomic file writes
    ├── logger.ts                ← Structured logging
    ├── retry.ts                 ← Exponential backoff
    └── split-message.ts         ← Discord 2000-char splitting
```

## How It Works

1. **Message received** → Discord bot picks it up
2. **Command check** → If `!command`, dispatch to registered handler
3. **Queue** → Wait for an available slot (concurrency limit)
4. **Execute** → Spawn `claude -p` with streaming output
5. **Stream** → Real-time message updates in Discord (typing indicator + progressive edits)
6. **Complete** → Final message with reaction feedback (✅ or ⚠️)

The Claude Code CLI runs with full tool access (Read, Write, Bash, etc.), making it capable of reading code, running commands, making API calls, and managing infrastructure.

### Autonomous mode

On a schedule (cron / setInterval):

1. **Gate check** → Is the user idle? (activity cooldown)
2. **Fetch tasks** → Pull from Notion (or custom source)
3. **Score & sort** → Priority × urgency ranking
4. **Execute** → Run top tasks via Claude with context
5. **Evaluate** → Done / needs review / retry
6. **Update** → Sync status back to task source

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE).
