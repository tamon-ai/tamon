#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

function ask(question: string, fallback: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} (${fallback}): `, (answer) => {
      rl.close();
      resolve(answer.trim() || fallback);
    });
  });
}

function parseArgs(): { name?: string; botName?: string } {
  const args = process.argv.slice(2);
  const result: { name?: string; botName?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) {
      result.botName = args[++i];
    } else if (!args[i].startsWith("-")) {
      result.name = args[i];
    }
  }
  return result;
}

const PACKAGE_JSON = (name: string) => JSON.stringify({
  name,
  version: "0.1.0",
  private: true,
  scripts: {
    start: "node dist/index.js",
    dev: "npx tsx src/index.ts",
    build: "npx tsc",
  },
  dependencies: {
    "tamon-ai": "^0.1.0",
    "discord.js": "^14.16.3",
  },
  devDependencies: {
    "@types/node": "^22.0.0",
    tsx: "^4.21.0",
    typescript: "^5.9.0",
  },
  engines: { node: ">=20.0.0" },
}, null, 2);

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "commonjs",
    lib: ["ES2022"],
    outDir: "dist",
    rootDir: "src",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    declaration: true,
    sourceMap: true,
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist"],
}, null, 2);

const ENV_EXAMPLE = `# === Required ===
DISCORD_BOT_TOKEN=

# === Claude Code ===
CLAUDE_MODEL=claude-sonnet-4-20250514
TAMON_MAX_CONCURRENT=2
CLAUDE_MAX_EXECUTION_MINUTES=60

# === Assistant ===
TAMON_NAME=My Assistant
TZ=UTC
LOG_LEVEL=info

# === Notion (optional) ===
NOTION_API_KEY=
NOTION_DATABASES=tasks:your-db-id

# === Webhook (optional) ===
WEBHOOK_PORT=3456
WEBHOOK_AUTH_TOKEN=
`;

const BOT_TEMPLATE = (botName: string) => `import { Events } from "discord.js";
import {
  getConfig,
  createClient,
  respond,
  CommandRegistry,
  ExecutionQueue,
  logger,
} from "tamon-ai";

async function main(): Promise<void> {
  const config = getConfig();
  const queue = new ExecutionQueue(config.claude.maxConcurrent);
  const commands = new CommandRegistry("!");
  const client = createClient();

  commands.register("ping", async (message) => {
    await message.reply("Pong!");
  });

  commands.register("status", async (message) => {
    const s = queue.getStatus();
    await message.reply(
      \`**${botName}** — Active: \${s.active}/\${s.maxConcurrent} | Queued: \${s.queued}\`,
    );
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.content.trim()) return;
    if (await commands.handle(message)) return;

    const id = message.id;
    try {
      queue.cancelPendingForChannel(message.channelId, id);
      await queue.enqueue(id, message.channelId);
      await respond(message, {
        systemPrompt: "You are ${botName}, a helpful AI assistant. Be concise and friendly.",
        model: config.claude.model,
        maxExecutionMs: config.claude.maxExecutionMinutes * 60 * 1000,
      });
    } catch (err: any) {
      if (err.message !== "Cancelled by newer message") {
        logger.error("[bot]", err);
      }
    } finally {
      queue.release(id);
    }
  });

  client.on(Events.ClientReady, (c) => {
    logger.info(\`[${botName.toLowerCase()}] Online as \${c.user.tag}\`);
  });

  await client.login(config.discord.botToken);
}

main().catch(console.error);
`;

const GITIGNORE = `node_modules/
dist/
.env
*.log
`;

function toTitleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main(): Promise<void> {
  const parsed = parseArgs();
  const isTTY = process.stdin.isTTY;

  let dirName: string;
  let botName: string;

  if (parsed.name) {
    dirName = parsed.name;
    botName = parsed.botName || toTitleCase(dirName);
  } else if (isTTY) {
    console.log("\n  🤖 TAMON — Create a new AI assistant\n");
    dirName = await ask("Project name", "my-assistant");
    botName = parsed.botName || await ask("Bot display name", toTitleCase(dirName));
  } else {
    dirName = "my-assistant";
    botName = "My Assistant";
  }

  const dir = path.resolve(process.cwd(), dirName);

  if (fs.existsSync(dir)) {
    console.error(`\n  Error: ${dir} already exists.\n`);
    process.exit(1);
  }

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });

  const files: [string, string][] = [
    ["package.json", PACKAGE_JSON(dirName)],
    ["tsconfig.json", TSCONFIG],
    [".env.example", ENV_EXAMPLE],
    [".env", ENV_EXAMPLE],
    [".gitignore", GITIGNORE],
    ["src/index.ts", BOT_TEMPLATE(botName)],
  ];

  for (const [file, content] of files) {
    fs.writeFileSync(path.join(dir, file), content + "\n");
  }

  console.log(`
  ✅ Created ${dirName}/

  Next steps:

    cd ${dirName}
    npm install

    # Edit .env — set DISCORD_BOT_TOKEN
    # (Create a bot at https://discord.com/developers/applications)

    # Install Claude Code CLI
    # https://docs.anthropic.com/en/docs/claude-code

    npm run dev
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
