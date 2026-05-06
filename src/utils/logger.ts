export type LogLevel = "debug" | "info" | "warn" | "error";

let currentLevel: LogLevel = "info";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function setLevel(level: LogLevel): void {
  currentLevel = level;
}

function timestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

export function debug(message: string, ...args: unknown[]): void {
  if (shouldLog("debug")) console.debug(`[${timestamp()}] [DEBUG] ${message}`, ...args);
}

export function info(message: string, ...args: unknown[]): void {
  if (shouldLog("info")) console.log(`[${timestamp()}] [INFO] ${message}`, ...args);
}

export function warn(message: string, ...args: unknown[]): void {
  if (shouldLog("warn")) console.warn(`[${timestamp()}] [WARN] ${message}`, ...args);
}

export function error(message: string, ...args: unknown[]): void {
  if (shouldLog("error")) console.error(`[${timestamp()}] [ERROR] ${message}`, ...args);
}
