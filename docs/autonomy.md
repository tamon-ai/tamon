# Autonomous Task Execution

TAMON can execute tasks autonomously — scoring them by priority and due date, running them via Claude, and tracking results.

## Setup

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
    console.log(`Done: ${task.title}: ${result.slice(0, 100)}`);
  },
  onTaskFailed: async (task, error) => {
    console.log(`Failed: ${task.title}: ${error}`);
  },
  onReviewNeeded: async (task, result) => {
    console.log(`Needs review: ${task.title}`);
  },
});

// Run one cycle (call this from a cron or scheduler)
await executor.run();
```

## Task Scoring

The default scorer prioritizes tasks by:

| Factor | Points |
|--------|--------|
| Overdue | 100 + (days overdue x 10) |
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

## Task Preparation

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

## Activity Gate

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

## Custom Task Source

Implement the `TaskSource` interface for any backend:

```typescript
import { TaskSource, Task } from "@tamon-ai/core/autonomy";

class MyTaskSource implements TaskSource {
  async fetchTasks(): Promise<Task[]> {
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
