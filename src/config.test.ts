import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("loadConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    savedEnv.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
    savedEnv.TZ = process.env.TZ;
    savedEnv.TAMON_CHANNELS = process.env.TAMON_CHANNELS;
    savedEnv.NOTION_DATABASES = process.env.NOTION_DATABASES;

    process.env.DISCORD_BOT_TOKEN = "test-token-123";
    delete process.env.TZ;
    delete process.env.TAMON_CHANNELS;
    delete process.env.NOTION_DATABASES;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("reads required DISCORD_BOT_TOKEN", async () => {
    const { loadConfig } = await import("./config");
    const config = loadConfig();
    expect(config.discord.botToken).toBe("test-token-123");
  });

  it("throws when DISCORD_BOT_TOKEN is missing", async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    const { loadConfig } = await import("./config");
    expect(() => loadConfig()).toThrow("Missing required environment variable: DISCORD_BOT_TOKEN");
  });

  it("applies defaults for optional values", async () => {
    const { loadConfig } = await import("./config");
    const config = loadConfig();
    expect(config.claude.model).toBe("claude-sonnet-4-20250514");
    expect(config.claude.maxConcurrent).toBe(2);
    expect(config.webhook.port).toBe(3456);
    expect(config.assistant.name).toBe("TAMON");
    expect(config.assistant.timezone).toBe("UTC");
  });

  it("parses TAMON_CHANNELS map", async () => {
    process.env.TAMON_CHANNELS = "hub:111,tasks:222,logs:333";
    const { loadConfig } = await import("./config");
    const config = loadConfig();
    expect(config.discord.channels).toEqual({ hub: "111", tasks: "222", logs: "333" });
  });

  it("parses NOTION_DATABASES map", async () => {
    process.env.NOTION_DATABASES = "tasks:abc,knowledge:def";
    const { loadConfig } = await import("./config");
    const config = loadConfig();
    expect(config.notion.databases).toEqual({ tasks: "abc", knowledge: "def" });
  });

  it("returns empty map for empty channel/db strings", async () => {
    const { loadConfig } = await import("./config");
    const config = loadConfig();
    expect(config.discord.channels).toEqual({});
    expect(config.notion.databases).toEqual({});
  });
});
