import { config as dotenvConfig } from "dotenv";
import * as logger from "./utils/logger";

dotenvConfig();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback = ""): string {
  return process.env[key] || fallback;
}

export interface TamonConfig {
  discord: {
    botToken: string;
    channels: Record<string, string>;
  };
  claude: {
    model: string;
    maxConcurrent: number;
    maxExecutionMinutes: number;
  };
  notion: {
    apiKey: string;
    databases: Record<string, string>;
  };
  webhook: {
    port: number;
    authToken: string;
  };
  assistant: {
    name: string;
    timezone: string;
    logLevel: string;
  };
  google: {
    saKeyFile: string;
    saImpersonateEmail: string;
    oauthClientId: string;
    oauthClientSecret: string;
    oauthRefreshToken: string;
    calendarId: string;
  };
  slack: {
    botToken: string;
    userToken: string;
  };
  telegram: {
    botToken: string;
  };
}

export function loadConfig(): TamonConfig {
  return {
    discord: {
      botToken: required("DISCORD_BOT_TOKEN"),
      channels: parseChannelMap(optional("TAMON_CHANNELS", "")),
    },
    claude: {
      model: optional("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
      maxConcurrent: parseInt(optional("TAMON_MAX_CONCURRENT", "2"), 10),
      maxExecutionMinutes: parseInt(optional("CLAUDE_MAX_EXECUTION_MINUTES", "60"), 10),
    },
    notion: {
      apiKey: optional("NOTION_API_KEY", ""),
      databases: parseDatabaseMap(optional("NOTION_DATABASES", "")),
    },
    webhook: {
      port: parseInt(optional("WEBHOOK_PORT", "3456"), 10),
      authToken: optional("WEBHOOK_AUTH_TOKEN", ""),
    },
    assistant: {
      name: optional("TAMON_NAME", "TAMON"),
      timezone: optional("TZ", "UTC"),
      logLevel: optional("LOG_LEVEL", "info"),
    },
    google: {
      saKeyFile: optional("GOOGLE_SA_KEY_FILE"),
      saImpersonateEmail: optional("GOOGLE_SA_IMPERSONATE_EMAIL"),
      oauthClientId: optional("GOOGLE_OAUTH_CLIENT_ID"),
      oauthClientSecret: optional("GOOGLE_OAUTH_CLIENT_SECRET"),
      oauthRefreshToken: optional("GOOGLE_OAUTH_REFRESH_TOKEN"),
      calendarId: optional("GOOGLE_CALENDAR_ID", "primary"),
    },
    slack: {
      botToken: optional("SLACK_BOT_TOKEN"),
      userToken: optional("SLACK_USER_TOKEN"),
    },
    telegram: {
      botToken: optional("TELEGRAM_BOT_TOKEN"),
    },
  };
}

// TAMON_CHANNELS="hub:123456,tasks:789012,logs:345678"
function parseChannelMap(raw: string): Record<string, string> {
  if (!raw) return {};
  const map: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [key, id] = pair.split(":");
    if (key && id) map[key.trim()] = id.trim();
  }
  return map;
}

// NOTION_DATABASES="tasks:abc123,knowledge:def456"
function parseDatabaseMap(raw: string): Record<string, string> {
  if (!raw) return {};
  const map: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [key, id] = pair.split(":");
    if (key && id) map[key.trim()] = id.trim();
  }
  return map;
}

let _config: TamonConfig | null = null;

export function getConfig(): TamonConfig {
  if (!_config) {
    _config = loadConfig();
    logger.setLevel(_config.assistant.logLevel as "debug" | "info" | "warn" | "error");
  }
  return _config;
}
