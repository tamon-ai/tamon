export interface Task {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "rejected";
  priority: "high" | "medium" | "low";
  dueDate?: string;
  owner?: string;
  executionType?: "auto" | "manual";
  notes?: string;
  source?: string;
}

export interface ExecutionState {
  failures: Record<string, {
    failCount: number;
    lastAttempt: string;
    timeoutCount?: number;
    lastEscalated?: string;
  }>;
}

export interface TaskProgress {
  taskId: string;
  taskTitle: string;
  steps: string[];
  partialResult: string;
  lastAttempt: string;
}

export interface PrepAnalysis {
  canPrepare: boolean;
  prepSteps: { type: string; description: string; effort: "small" | "medium" | "large" }[];
  requiresHuman: string[];
  recommendation: string;
}

export interface PrepState {
  tasks: Record<string, {
    analyzedAt: string;
    analysis: PrepAnalysis;
    prepDone: boolean;
    prepResult?: string;
    prepDoneAt?: string;
  }>;
}

export interface TaskSource {
  fetchTasks(): Promise<Task[]>;
  updateStatus(taskId: string, status: Task["status"]): Promise<void>;
  addNote(taskId: string, note: string): Promise<void>;
}

export type TaskScorer = (task: Task) => number;
export type ResultEvaluator = (result: string) => "done" | "review" | "retry";
