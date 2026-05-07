<p align="center">
  <h1 align="center">TAMON</h1>
  <p align="center">
    <strong>Your AI assistant that actually does things.</strong>
    <br />
    Not a chatbot. A self-hosted AI agent that manages your tasks, reads your email, checks your calendar, and works while you sleep.
  </p>
  <p align="center">
    <a href="#quick-start">Quick Start</a> &bull;
    <a href="#under-the-hood">Technical Deep Dive</a> &bull;
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

## Why not just use LangChain / CrewAI / another framework?

Most agent frameworks do the same thing: define tool schemas in JSON → send them to an LLM API → parse the response → call your function → repeat. You're building the agent's hands out of JSON.

TAMON doesn't call an LLM API. It spawns [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as a **child process with a full shell session**. The AI gets filesystem access, git, curl, package managers, databases — the same tools a developer has.

```
Typical framework:   LLM API  →  tool schema matching  →  predefined function  →  response
TAMON:               Claude Code process (with shell)   →  does whatever is needed →  streams back
```

This is a different category of tradeoff, not a minor variation:

| | Tool-schema frameworks | TAMON (process-per-request) |
|---|---|---|
| Adding capabilities | Write tool schema + handler function | Install a binary on the server |
| Composability | Framework orchestrates tool chains | Shell pipes and scripts — the AI composes like a developer |
| State isolation | Shared memory across tools within a session | Each process starts clean, can't corrupt another |
| Context management | Growing context window (degrades over time) | Fresh identity injection per request (deterministic) |
| Failure blast radius | Bad tool call can poison the session | Process dies, queue promotes the next one |
| Latency | Single API round-trip per tool call | Process startup (~2s), but shell ops are native speed |

The latency tradeoff is real. Process startup adds ~2 seconds. For rapid-fire tool chaining (search → filter → transform), API-based frameworks are faster per step. TAMON compensates by letting the AI chain operations inside a single process — it runs 10 shell commands in sequence without round-tripping to your code.

## Under the hood

If you've built AI agent systems before, these are the decisions that might interest you. If you just want to use TAMON, skip to [Quick Start](#quick-start).

### Identity injection vs. persistent context

Every Claude Code process starts with zero memory. TAMON compensates by assembling a prompt from scratch on every invocation:

```typescript
const prompt = [
  identity,          // personality, behavioral rules, safety constraints
  integrationStatus, // which APIs are configured right now
  channelContext,    // recent messages, thread history, channel purpose
  taskState,         // if autonomous: task metadata, progress notes
].join("\n\n---\n\n") + `\n\nUser message: ${message}`;
```

This is a deliberate choice over long-running sessions. Context windows degrade — they fill with stale tool outputs, irrelevant history, and attention dilution. Identity injection is deterministic: every invocation gets exactly the context it needs, assembled at call time. The 50th message gets the same quality of response as the 1st.

The cost: no conversational memory within a session unless you explicitly build it (TAMON provides hooks for this via the Notion knowledge base, or you can plug in your own persistence).

### Queue and per-channel cancellation

Multiple messages compete for Claude Code slots. The queue is a semaphore with one critical behavior: **when a new message arrives in a channel, any *pending* (not yet running) messages from that channel are cancelled.**

```
User types: "What's the weather?"        → queued
User types: "Never mind, check my email" → previous message cancelled, this one queued
```

This prevents the AI from answering a question the user already moved past. Running processes are not interrupted — only pending ones. This distinction matters: interrupting a process mid-file-edit could leave corrupt state.

### Process tree cleanup

When a Claude Code process finishes (or times out), TAMON kills the entire process tree — not just the parent PID. Claude Code spawns subprocesses (shell commands, git operations, language servers), and a naive `process.kill()` leaves orphans that accumulate and eventually exhaust memory.

```
kill process → pgrep -P $pid → recursive kill → verify with process.kill(pid, 0)
```

The `CLAUDECODE` environment variable is stripped before spawning to prevent the AI from nesting Claude Code processes inside itself — an infinite recursion that will take down your server.

### Git worktree isolation

When multiple concurrent sessions need to edit files (e.g., two conversations both modifying source code), TAMON creates a [git worktree](https://git-scm.com/docs/git-worktree) per session. Each Claude Code process works in its own checkout. On completion, changes are applied to the main tree via `git diff | git apply`.

```
Session A (editing auth.ts)  → /tmp/tamon-worktrees/wt-a8f3/ (isolated)
Session B (editing routes.ts) → /tmp/tamon-worktrees/wt-b2c1/ (isolated)
Main tree (/opt/tamon)       → untouched until sessions complete
```

Heavy directories (`node_modules`, `dist`) are symlinked, not copied — each worktree costs ~5MB. Conflict detection saves `.patch` files for manual resolution rather than silently dropping changes.

### Autonomous task execution — how it actually works

The autonomy engine isn't "run a prompt on a cron." It's a five-stage pipeline with real safety:

**1. Activity gate.** Before running any autonomous task, TAMON scans all Discord channels. If anyone sent a message within the cooldown window (default 5 minutes), autonomous execution is blocked. The AI doesn't interrupt your conversation to tell you it completed a task.

**2. Score and rank.** Tasks are pulled from the source (Notion database by default) and scored:
```
score = priority_weight × due_date_proximity × staleness_bonus
```
A task due tomorrow with high priority that hasn't been touched in 3 days scores higher than a low-priority task due next week that was updated today.

**3. Two-phase preparation.** Before executing, the `TaskPreparator` runs a lightweight analysis: Can this task be partially prepared? Does it need human judgment? Only small/medium effort preparation steps execute automatically. Large items are flagged with notes, not attempted.

**4. Execute with limits.** Top N tasks (default 2) run concurrently. Each gets its own Claude Code process with task metadata, context, and previous progress notes injected via identity.

**5. Circuit breaker.** If a task fails twice in one day, it's escalated — not retried. The AI doesn't bang its head against the same wall. Failure counts persist to disk via atomic writes, surviving process restarts and crashes.

### Timeout hierarchy

Three layers, from most to least patient:

| Layer | Default | Catches |
|---|---|---|
| Inactivity timeout | 10 min | Hung tool execution (process produces no output) |
| Max execution timeout | 60 min | Runaway processes, infinite loops |
| Queue drain timeout | 90 sec | Graceful shutdown — finish running, reject queued |

### Streaming to Discord

Responses stream in real-time, not as a batch after completion:

```
Claude Code stdout → buffer → 1.5s throttle → Discord message edit
```

Phase detection on stderr identifies whether the AI is thinking, using a tool, or generating text — so the UI can indicate state. Messages exceeding Discord's 2000-char limit are automatically split. A typing indicator fires every 8 seconds so the user sees activity during long operations.

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
import { CommandRegistry } from "tamon-ai/core/discord";

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

### 15 integrations, all opt-in

Add credentials to `.env` and they auto-detect on startup. No configuration files, no plugin registry.

| Category | Integration | Key capabilities |
|---|---|---|
| **Google Workspace** | Gmail | Read, search, draft, reply (RFC 2047 headers, thread-aware) |
| | Calendar | CRUD, free/busy, SA impersonation for team scheduling |
| | Drive | Search, list, upload, download, folder traversal |
| | Contacts | Search, list, create (People API v1) |
| **Development** | GitHub | Repos, issues, PRs, notifications, activity feed |
| | Vercel | Projects, deployments, environment variables |
| | Linear | Issues (CRUD), teams, search (GraphQL) |
| | Supabase | PostgREST queries, RPC, management SQL |
| **Analytics** | GA4 | Reports, pageviews, active users, top pages (Data API v1) |
| | Search Console | Sites, search performance, top queries |
| **Communication** | Slack | Messages, search, file sharing (uploadV2) |
| | Telegram | Bot messaging, smart message splitting (4096 char) |
| | X (Twitter) | Post, delete, timeline, search (OAuth 1.0a) |
| **Core** | Notion | Tasks, knowledge base, persistent memory |
| | Webhook API | Custom HTTP endpoints with token auth |

Adding your own: write the module, add env vars, export. [Full guide →](docs/integrations.md)

### Autonomous task execution

TAMON doesn't just respond — it works on its own.

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
                    |     \-- Claude Code CLI (streaming, process-per-request)
                    |
                    +-- Queue (semaphore, per-channel cancellation)
                    |
                    +-- Identity Injection (personality + integrations + context)
                    |
                    +-- Notion (tasks, knowledge, persistent memory)
                    |
                    +-- Integrations (15 modules, opt-in via env vars)
                    |     +-- Google Workspace (Gmail, Calendar, Drive, Contacts)
                    |     +-- Dev tools (GitHub, Vercel, Linear, Supabase)
                    |     +-- Analytics (GA4, Search Console)
                    |     \-- Messaging (Slack, Telegram, X)
                    |
                    \-- Autonomy Engine
                          +-- Task scoring (priority × urgency × staleness)
                          +-- Two-phase preparation
                          +-- Activity gate (won't interrupt conversations)
                          +-- Circuit breaker (max 2 failures/day per task)
                          \-- Git worktree isolation (concurrent file editing)
```

Each piece is a single file with a clear interface. No plugin system, no middleware chain, no event bus. [Full architecture deep-dive →](docs/architecture.md)

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
