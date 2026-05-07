import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const TAMON_ROOT = path.resolve(__dirname, "../..");
const E2E_DIR = path.join("/tmp", `tamon-e2e-${Date.now()}`);
const PROJECT_DIR = path.join(E2E_DIR, "e2e-bot");

function run(cmd: string, cwd = E2E_DIR): string {
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    timeout: 180_000,
    env: { ...process.env, NODE_ENV: "development" },
  });
}

afterAll(() => {
  if (fs.existsSync(E2E_DIR)) {
    fs.rmSync(E2E_DIR, { recursive: true, force: true });
  }
});

describe("E2E: scaffold → install → build → import", () => {
  it("scaffolds a project with tamon-ai init", () => {
    fs.mkdirSync(E2E_DIR, { recursive: true });
    const output = run(
      `node ${path.join(TAMON_ROOT, "dist/cli/init.js")} e2e-bot --name E2EBot`,
    );
    expect(output).toContain("Created e2e-bot/");
    expect(fs.existsSync(path.join(PROJECT_DIR, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(PROJECT_DIR, "src/index.ts"))).toBe(true);
  });

  it("installs dependencies (local tamon-ai link)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "package.json"), "utf-8"));
    pkg.dependencies["tamon-ai"] = `file:${TAMON_ROOT}`;
    fs.writeFileSync(path.join(PROJECT_DIR, "package.json"), JSON.stringify(pkg, null, 2));

    run("npm install", PROJECT_DIR);
    expect(fs.existsSync(path.join(PROJECT_DIR, "node_modules/tamon-ai"))).toBe(true);
    expect(fs.existsSync(path.join(PROJECT_DIR, "node_modules/discord.js"))).toBe(true);
  });

  it("builds successfully with tsc", () => {
    run("npx tsc", PROJECT_DIR);
    expect(fs.existsSync(path.join(PROJECT_DIR, "dist/index.js"))).toBe(true);
  });

  it("tamon-ai exports are importable", () => {
    const check = `node -e "
      const t = require('tamon-ai');
      const exports = ['getConfig','loadConfig','createClient','respond','CommandRegistry',
        'ExecutionQueue','execute','executeStreaming','safeSend','safeEdit',
        'initNotion','queryDatabase','WebhookServer','TaskExecutor','logger',
        'TTLCache','withRetry','splitMessage'];
      const missing = exports.filter(e => typeof t[e] === 'undefined');
      if (missing.length) { console.error('Missing:', missing.join(', ')); process.exit(1); }
      console.log('All', exports.length, 'exports verified');
    "`;
    const output = run(check, PROJECT_DIR);
    expect(output).toContain("exports verified");
  });

  it("generated bot code type-checks", () => {
    run("npx tsc --noEmit", PROJECT_DIR);
  });
});
