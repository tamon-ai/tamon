# Contributing to TAMON

Thank you for your interest in contributing to TAMON!

## Development Setup

```bash
git clone https://github.com/tamon-ai/tamon.git
cd tamon
npm install
cp .env.example .env
# Fill in at least DISCORD_BOT_TOKEN
```

### Running in development

```bash
npm run dev        # Run with tsx (hot reload)
npm run build      # Compile TypeScript
npm run typecheck  # Type check without emitting
```

## Guidelines

### Code Style

- TypeScript strict mode
- async/await (no callbacks)
- Barrel exports via `index.ts` for each module
- Namespace imports for utils: `import * as logger from "../utils/logger"`
- Config access only via `getConfig()` — never `process.env` directly
- Error handling: try-catch with `logger.error("[module]", err)`

### Adding an Integration

1. Create `src/integrations/your-service.ts`
2. Add config keys to `TamonConfig` interface in `src/config.ts`
3. Add env vars to `loadConfig()` with `optional()`
4. Add env vars to `.env.example`
5. Export from `src/integrations/index.ts`
6. Add `isYourServiceConfigured()` function and log it in `src/index.ts`

### Adding a Task Source

Implement the `TaskSource` interface from `src/autonomy/types.ts`:

```typescript
interface TaskSource {
  fetchTasks(): Promise<Task[]>;
  updateStatus(taskId: string, status: Task["status"]): Promise<void>;
  addNote(taskId: string, note: string): Promise<void>;
}
```

### Commits

- One logical change per commit
- Use conventional commit messages: `feat:`, `fix:`, `docs:`, `refactor:`
- Run `npm run typecheck` before committing

### Pull Requests

- Keep PRs focused on a single feature or fix
- Include a description of what changed and why
- Ensure TypeScript compiles without errors

## Project Structure

See [README.md](README.md#project-structure) for the full directory layout.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
