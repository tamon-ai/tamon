// TAMON — public API surface
// Users: import { getConfig, createClient, respond, ... } from "tamon-ai"

// Config
export { getConfig, loadConfig } from "./config";
export type { TamonConfig } from "./config";

// Discord
export {
  createClient,
  respond,
  CommandRegistry,
  safeSend,
  safeEdit,
  startTypingLoop,
} from "./core/discord";
export type {
  CreateClientOptions,
  RespondOptions,
  RespondResult,
  CommandHandler,
  SafeSendResult,
  TypingLoop,
} from "./core/discord";

// Claude Code executor
export {
  ExecutionQueue,
  execute,
  executeStreaming,
  killAllActive,
  killByChannel,
  resetCancellation,
  isUsageLimitError,
  isAuthError,
} from "./core/claude";
export type {
  Phase,
  StreamCallback,
  PhaseCallback,
  RetryCallback,
  ExecuteOptions,
  StreamingOptions,
  ExecuteResult,
} from "./core/claude";

// Notion
export {
  initNotion,
  getNotion,
  queryDatabase,
  createPage,
  updatePage,
  invalidateCache,
} from "./core/notion";

// Webhook
export { WebhookServer } from "./core/webhook";
export type { RouteHandler, WebhookServerOptions } from "./core/webhook";

// Autonomy
export {
  TaskExecutor,
  NotionTaskSource,
  TaskPreparator,
  canRunAutonomousTasks,
  registerActivity,
  setGate,
  setCooldown,
  clearActivity,
  defaultScorer,
  defaultEvaluator,
} from "./autonomy";
export type {
  Task,
  ExecutionState,
  TaskProgress,
  PrepAnalysis,
  PrepState,
  TaskSource,
  TaskScorer,
  ResultEvaluator,
  TaskExecutorOptions,
  TaskPreparatorOptions,
} from "./autonomy";

// Integrations
export * from "./integrations";

// Utils
export { logger, TTLCache, withRetry, splitMessage, writeFileAtomic } from "./utils";
export type { RetryOptions } from "./utils";
