import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const TEST_DIR = path.join("/tmp", `tamon-cli-test-${Date.now()}`);

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

function runInit(args: string): string {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  return execSync(`node ${path.join(__dirname, "../../dist/cli/init.js")} ${args}`, {
    cwd: TEST_DIR,
    encoding: "utf-8",
    env: { ...process.env, NODE_ENV: "test" },
  });
}

describe("CLI init", () => {
  it("generates project with correct structure", () => {
    const output = runInit("test-bot --name TestBot");
    const projectDir = path.join(TEST_DIR, "test-bot");

    expect(fs.existsSync(projectDir)).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "tsconfig.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".env"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".env.example"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src/index.ts"))).toBe(true);

    expect(output).toContain("Created test-bot/");
  });

  it("uses bot name in generated code", () => {
    runInit("my-bot --name MyCustomBot");
    const src = fs.readFileSync(path.join(TEST_DIR, "my-bot/src/index.ts"), "utf-8");
    expect(src).toContain("MyCustomBot");
  });

  it("generates valid package.json", () => {
    runInit("pkg-test");
    const pkg = JSON.parse(
      fs.readFileSync(path.join(TEST_DIR, "pkg-test/package.json"), "utf-8"),
    );
    expect(pkg.name).toBe("pkg-test");
    expect(pkg.dependencies["tamon-ai"]).toBeDefined();
    expect(pkg.dependencies["discord.js"]).toBeDefined();
  });

  it("generates valid tsconfig.json", () => {
    runInit("ts-test");
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(TEST_DIR, "ts-test/tsconfig.json"), "utf-8"),
    );
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.target).toBe("ES2022");
  });

  it("fails when directory already exists", () => {
    runInit("conflict-test");
    expect(() => runInit("conflict-test")).toThrow();
  });

  it("defaults bot name from project name (title case)", () => {
    runInit("cool-assistant");
    const src = fs.readFileSync(path.join(TEST_DIR, "cool-assistant/src/index.ts"), "utf-8");
    expect(src).toContain("Cool Assistant");
  });
});
