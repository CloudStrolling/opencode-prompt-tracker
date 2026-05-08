# AGENTS.md — OpenCode Prompt Recorder

This is an OpenCode plugin. Not a standalone app. Plugin development has different conventions than app development.

## Developer Commands

```bash
npm run build    # Build TypeScript + esbuild bundle → dist/release/opencode-prompt-tracker.js
npm run dev      # Watch mode: tsc --watch
npm test        # Run tests with Bun (bun test)
```

**Build order**: `tsc` compiles to `dist/`, then `esbuild` bundles to `dist/release/`. Always run `build` before testing locally.

## Project Structure

```
src/
├── index.ts              # Main plugin — hook handlers (chat.message, event)
├── types.ts             # TypeScript interfaces (SessionState, MessageStep, LogData)
└── utils/
    ├── file-writer.ts   # Writes .md logs to .opencode/prompts/
    ├── agent-extractor.ts # Parses agent chain from message parts
    └── logger.ts       # Plugin logging to OpenCode console

tests/
├── file-writer.test.ts
└── agent-extractor.test.ts
```

## Code Conventions

- **Formatter**: Prettier (`.prettierrc`)
  - Single quotes, semicolons, 2 spaces, 100 char width
- **TypeScript**: Strict mode (`tsconfig.json`)
- **Runtime**: Supports both Bun and Node.js
  - Uses `typeof Bun !== 'undefined'` check
  - Falls back to Node.js `fs` module

## Key Implementation Details

- **Entry**: `PromptRecorderPlugin` async factory in `src/index.ts`
- **Hooks used**:
  - `chat.message` — captures user prompt + initial state
  - `event.message.part.updated` — collects text for task descriptions
  - `event.message.updated` — logs each assistant step
  - `event.session.idle` — writes final summary
- **Token tracking**: Includes cached/uncached breakdown
- **Output**: Markdown files in `<project>/.opencode/prompts/`

## Local Testing

To test plugin changes locally in an OpenCode project:

```bash
# 1. Build plugin
npm run build

# 2. Copy to test project
mkdir -p <test-project>/.opencode/plugins/
cp dist/release/opencode-prompt-tracker.js <test-project>/.opencode/plugins/

# 3. Add to test project's opencode.json:
{ "plugin": ["opencode-prompt-tracker"] }
```

## Publishing

```bash
npm version patch  # or minor/major
npm run build
npm publish
```