# Architecture

Most AI agent frameworks are wrappers around an LLM API. You define tools, write schemas, and hope the model picks the right one. TAMON takes a fundamentally different approach.

## The core idea: wrap a developer, not an API

TAMON spawns **Claude Code CLI processes** — not API calls. Each invocation gives the AI a full shell session: filesystem access, git, package managers, curl, databases, anything you can do in a terminal.

```
Typical framework:
  User message → LLM API → tool schema matching → predefined function call → response

TAMON:
  User message → Claude Code CLI process (with shell access) → does whatever is needed → streams response
```

This isn't a cosmetic difference. It means:

- **No tool schema bottleneck.** The AI doesn't need a predefined tool for every action. Need to check disk space? It runs `df -h`. Need to query a database? It runs `psql`. Need to fix a bug? It reads the file, edits it, runs the tests.
- **Composable by default.** Shell commands pipe into each other. The AI chains operations the same way a developer would — no orchestration framework required.
- **New capabilities without new code.** Installing `ffmpeg` on the server means the AI can now process video. No integration to write, no tool schema to register.

The tradeoff is that each Claude Code process is stateless — it starts fresh with no memory of previous runs. TAMON solves this through identity injection (below).

## Process lifecycle

```
1. Message arrives (Discord / webhook / cron trigger)
        │
2. Queue checks concurrency (semaphore, default max=2)
        │
3. Identity is assembled:
   ├── System prompt (personality, rules, capabilities)
   ├── Integration status (which APIs are configured)
   ├── Channel context (recent messages, thread history)
   └── Task state (if autonomous execution)
        │
4. Claude Code CLI spawned as child process
   ├── stdin: assembled prompt
   ├── stdout: streamed back to Discord in real-time
   ├── stderr: parsed for phase detection (thinking/tool_use/generating)
   └── env: sanitized (CLAUDECODE removed to prevent nesting)
        │
5. Post-execution:
   ├── Result evaluation (done / needs-review / retry)
   ├── Queue slot released → next waiting message promoted
   └── Process tree killed (recursive pgrep to catch orphans)
```

## Identity injection

Every Claude Code process starts with zero context. TAMON compensates by building a rich prompt that contains everything the AI needs to act correctly:

```typescript
const prompt = `${identity}\n\n${integrationContext}\n\n---\n\nUser message: ${message}`;
```

The identity includes:
- **Who it is** — name, personality, behavioral rules
- **What it can access** — which integrations are configured, what tools are available
- **Where it is** — channel name, thread context, recent conversation history
- **What it should not do** — safety rules, rate limits, forbidden operations

This is a deliberate design choice over long-running context windows. Context windows degrade — they fill with noise, old tool outputs, and irrelevant history. Identity injection is deterministic: every invocation gets exactly the context it needs, nothing more.

## Streaming

TAMON streams Claude's output to Discord in real-time, not as a batch response after completion.

```
Claude CLI stdout ──chunk──> buffer ──1.5s throttle──> Discord message edit
                                                        (or new message if none exists)
```

The responder maintains a typing indicator loop (every 8 seconds) so the user sees activity even during long tool executions. Phase detection on stderr lets the UI indicate whether the AI is thinking, using a tool, or generating text.

If the response exceeds Discord's 2000-character limit, it's automatically split across multiple messages.

## Queue and concurrency

Multiple users (or autonomous tasks + user messages) compete for Claude Code slots. The `ExecutionQueue` is a semaphore:

```
enqueue("msg-123", "channel-456")
  → active < maxConcurrent? Run immediately.
  → Otherwise: park in queue, return a Promise that resolves when a slot opens.

release("msg-123")
  → Decrement active count.
  → If queue is non-empty: promote next entry, increment active.
```

A critical feature: **per-channel cancellation**. When a new message arrives in a channel, any *pending* (not yet running) messages from that channel are cancelled. This prevents the AI from answering an outdated question when the user has already moved on.

Graceful shutdown drains the queue with a configurable timeout — running processes finish, queued ones are rejected.

## Autonomous execution

TAMON can work without being asked. The `TaskExecutor` runs on a cron cycle:

1. **Gate check** — `canRunAutonomousTasks()` scans all channels. If *any* channel had activity within the cooldown window (default 5 minutes), autonomous execution is blocked. This prevents the AI from interrupting a conversation.

2. **Fetch and score** — Tasks are pulled from the configured source (e.g., Notion database) and scored by priority, due date proximity, and staleness.

3. **Execute** — Top N tasks (default 2) run concurrently via Claude Code. Each task gets a prompt with its metadata, context, and any previous progress notes.

4. **Evaluate** — Results are classified as `done`, `needs-review`, or `retry` based on pattern matching against the output. Failed tasks increment a per-day failure counter.

5. **Circuit breaker** — If a task fails `maxFailuresPerDay` times (default 2), it's escalated rather than retried. The AI doesn't bang its head against the same wall.

State (failure counts, progress notes) is persisted to disk via atomic writes, surviving process restarts.

### Task preparation

A separate `TaskPreparator` handles two-phase analysis:
- **Phase 1**: Analyze the task via Claude — can it be prepared? What are the steps? Does it require human judgment?
- **Phase 2**: Execute only small/medium effort preparation steps. Large-effort items that need human input are flagged, not attempted.

This means when you sit down to work, your tasks already have research done, context gathered, and implementation notes ready.

## Integrations

Integrations are opt-in via environment variables. Each one exports an `isConfigured()` check:

```typescript
// At startup
if (isGoogleConfigured()) logger.info("Google Calendar/Gmail ready");
if (isSlackConfigured())  logger.info("Slack ready");
// unconfigured integrations are silently skipped

// At runtime
export async function getEmails(query: string) {
  if (!isGoogleConfigured()) return [];
  // ... actual implementation
}
```

Adding a new integration means:
1. Write the module with an `isConfigured()` check
2. Add env vars to `.env.example`
3. Done — it's available to the AI on next restart

No plugin registry, no dependency injection, no configuration files to maintain. If the env var exists, the integration works.

## Safety

### Process isolation
Each Claude Code invocation runs as a child process. Killing it (via process tree traversal) is guaranteed to clean up — no leaked connections, no orphaned state. The `CLAUDECODE` env var is stripped to prevent the AI from spawning nested Claude processes.

### Timeout hierarchy
- **Inactivity timeout** (default 10 min): kills the process if no output is produced. Catches hung tool executions.
- **Max execution timeout** (default 60 min): hard ceiling. No single invocation runs forever.
- **Queue shutdown timeout**: drains gracefully, then force-kills.

### Retry with backoff
Transient errors (rate limits, 503s, overloaded) trigger exponential backoff retries (3s → 6s, max 2 retries). Non-transient errors fail immediately.

### Git worktree isolation

When multiple concurrent sessions edit files (e.g., two conversations both modifying source code), they'll collide. TAMON solves this with [git worktrees](https://git-scm.com/docs/git-worktree):

- Sessions with file-edit permissions get their own worktree in `/tmp/tamon-worktrees/wt-{random}/`
- Heavy directories (`node_modules`, `dist`, `.env`, `data/`) are symlinked — each worktree costs ~5MB
- On completion: `git diff` → `git apply` to the main tree
- On conflict: `.patch` file saved to `data/worktree-conflict-*.patch` for manual resolution
- Crash/timeout: changes are rescued before cleanup

Read-only sessions (cron, autonomous tasks) skip worktree creation — zero overhead for the common case.

### Autonomous safety
- Activity gate prevents interrupting conversations
- Per-task failure limits prevent infinite retry loops
- Result evaluation catches "needs human review" patterns
- All state changes are atomic writes (no corruption on crash)

## Extending TAMON

The architecture is deliberately simple. There's no plugin system, no middleware chain, no event bus. The pieces are:

- `executor.ts` — spawns Claude, manages processes
- `queue.ts` — concurrency control
- `responder.ts` — Discord ↔ Claude bridge with streaming
- `activity-gate.ts` — autonomous execution safety
- `task-executor.ts` — autonomous task runner
- `integrations/*` — opt-in external service modules

Each is a single file with a clear interface. To customize TAMON, you modify the source directly. This is intentional — a framework that requires reading 50 files to understand how a message gets processed is a framework that nobody will modify.
