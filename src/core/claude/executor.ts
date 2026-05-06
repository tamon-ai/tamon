import { spawn, execSync, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import * as logger from "../../utils/logger";

export type Phase = "thinking" | "tool_use" | "generating";
export type StreamCallback = (chunk: string, fullText: string) => void;
export type PhaseCallback = (phase: Phase, detail?: string) => void;
export type RetryCallback = (attempt: number, maxRetries: number, errorMsg: string) => void;

export interface ExecuteOptions {
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  mcpConfigs?: string[];
  maxExecutionMs?: number;
  inactivityTimeoutMs?: number;
  channelId?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface StreamingOptions extends ExecuteOptions {
  onChunk?: StreamCallback;
  onPhase?: PhaseCallback;
  onRetry?: RetryCallback;
}

export interface ExecuteResult {
  text: string;
  exitCode: number;
  timedOut: boolean;
  elapsedMs: number;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_EXECUTION_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_INACTIVITY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY = 3000;

const activeProcesses = new Map<ChildProcess, string>();
let cancelled = false;

export function killAllActive(): void {
  cancelled = true;
  for (const [child] of activeProcesses) {
    if (child.pid) killProcessTree(child.pid);
  }
  activeProcesses.clear();
}

export function killByChannel(channelId: string): number {
  let count = 0;
  for (const [child, ch] of activeProcesses) {
    if (ch === channelId) {
      if (child.pid) killProcessTree(child.pid);
      activeProcesses.delete(child);
      count++;
    }
  }
  return count;
}

export function resetCancellation(): void {
  cancelled = false;
}

function killProcessTree(pid: number): void {
  try {
    const children = execSync(`pgrep -P ${pid} 2>/dev/null || true`, { timeout: 3000 })
      .toString().trim().split("\n").filter(Boolean);
    for (const childPid of children) {
      killProcessTree(parseInt(childPid, 10));
    }
  } catch {}
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

function cleanEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.CLAUDECODE; // Prevent nesting detection
  return env;
}

function buildCommand(prompt: string, options: ExecuteOptions): string {
  const model = options.model || DEFAULT_MODEL;
  let cmd = `claude -p --model ${model}`;

  if (options.systemPrompt) {
    cmd += ` --system-prompt`;
  }

  if (options.allowedTools?.length) {
    cmd += ` --allowedTools "${options.allowedTools.join(",")}"`;
  }

  if (options.mcpConfigs?.length) {
    for (const config of options.mcpConfigs) {
      if (existsSync(config)) {
        cmd += ` --mcp-config ${config}`;
      }
    }
  }

  return cmd;
}

export async function execute(prompt: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
  const result = await executeStreaming(prompt, {
    ...options,
    onChunk: undefined,
    onPhase: undefined,
  });
  return result;
}

export async function executeStreaming(
  prompt: string,
  options: StreamingOptions = {},
): Promise<ExecuteResult> {
  const maxExec = options.maxExecutionMs || DEFAULT_MAX_EXECUTION_MS;
  const inactivityTimeout = options.inactivityTimeoutMs || DEFAULT_INACTIVITY_MS;
  let lastAttemptError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (cancelled) return { text: "", exitCode: 1, timedOut: false, elapsedMs: 0 };

    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
      options.onRetry?.(attempt, MAX_RETRIES, lastAttemptError);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const result = await spawnClaude(prompt, options, maxExec, inactivityTimeout);
      if (isRetryableError(result.text) && attempt < MAX_RETRIES) {
        lastAttemptError = result.text.slice(0, 200);
        continue;
      }
      return result;
    } catch (err) {
      lastAttemptError = String(err);
      if (attempt === MAX_RETRIES) {
        return { text: `Error: ${lastAttemptError}`, exitCode: 1, timedOut: false, elapsedMs: 0 };
      }
    }
  }

  return { text: "", exitCode: 1, timedOut: false, elapsedMs: 0 };
}

function spawnClaude(
  prompt: string,
  options: StreamingOptions,
  maxExecMs: number,
  inactivityMs: number,
): Promise<ExecuteResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const cmd = buildCommand(prompt, options);
    const args = options.systemPrompt
      ? ["-c", `echo ${shellEscape(prompt)} | ${cmd} <<< ${shellEscape(options.systemPrompt)}`]
      : ["-c", `echo ${shellEscape(prompt)} | ${cmd}`];

    const child = spawn("bash", args, {
      cwd: options.cwd || process.cwd(),
      env: cleanEnv(options.env),
    });

    const channelId = options.channelId || "";
    activeProcesses.set(child, channelId);

    let fullText = "";
    let lastOutputTime = Date.now();
    let timedOut = false;

    const inactivityCheck = setInterval(() => {
      const silent = Date.now() - lastOutputTime;
      if (silent > inactivityMs) {
        logger.warn(`[executor] Inactivity timeout (${Math.floor(silent / 1000)}s)`);
        timedOut = true;
        if (child.pid) killProcessTree(child.pid);
        clearInterval(inactivityCheck);
      }
      if (Date.now() - startTime > maxExecMs) {
        logger.warn(`[executor] Max execution time exceeded`);
        timedOut = true;
        if (child.pid) killProcessTree(child.pid);
        clearInterval(inactivityCheck);
      }
    }, 30000);

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      fullText += chunk;
      lastOutputTime = Date.now();
      options.onChunk?.(chunk, fullText);
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      // Parse phase changes from stderr
      if (text.includes("thinking")) options.onPhase?.("thinking");
      else if (text.includes("tool_use")) options.onPhase?.("tool_use");
    });

    child.on("close", (code) => {
      clearInterval(inactivityCheck);
      activeProcesses.delete(child);
      resolve({
        text: fullText.trim(),
        exitCode: code ?? 1,
        timedOut,
        elapsedMs: Date.now() - startTime,
      });
    });

    child.on("error", (err) => {
      clearInterval(inactivityCheck);
      activeProcesses.delete(child);
      resolve({
        text: `Process error: ${err.message}`,
        exitCode: 1,
        timedOut: false,
        elapsedMs: Date.now() - startTime,
      });
    });
  });
}

function isRetryableError(text: string): boolean {
  const lc = text.toLowerCase();
  return (
    lc.includes("rate limit") ||
    lc.includes("overloaded") ||
    lc.includes("timeout") ||
    lc.includes("503") ||
    lc.includes("529")
  );
}

function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

export function isUsageLimitError(text: string): boolean {
  return text.toLowerCase().includes("usage limit");
}

export function isAuthError(text: string): boolean {
  const lc = text.toLowerCase();
  return lc.includes("authentication failed") || lc.includes("invalid api key");
}
