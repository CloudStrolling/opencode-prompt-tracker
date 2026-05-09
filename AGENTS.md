# AGENTS.md — OpenCode Prompt Tracker

OpenCode plugin that logs prompts, models, agents, duration, and token usage to daily Markdown files.

## Developer Commands

```bash
npm run build    # tsc → dist/ + esbuild → dist/release/opencode-prompt-tracker.js
npm run dev     # Watch mode: tsc --watch
npm test       # Bun test suite (bun test)
```

**Build order**: `tsc` compiles to `dist/`, then `esbuild` bundles to `dist/release/`. Always run `build` before local testing.

## Project Structure

```
src/
├── index.ts              # Main plugin — PromptRecorderPlugin factory + hooks
├── types.ts              # TypeScript interfaces (SessionState, MessageStep, LogData, Config)
└── utils/
    ├── file-writer.ts   # Writes .md logs to .opencode/prompts/
    ├── agent-extractor.ts # Parses agent chain from message parts
    ├── logger.ts        # Plugin logging (client + fallback file)
    ├── config.ts       # Config loader (opencode-prompt-tracker.config.json)
    └── billing.ts      # Token cost calculation

tests/
├── config.test.ts        # Config loading + defaults
├── billing.test.ts       # Cost calculation
├── file-writer.test.ts # Markdown formatting
└── agent-extractor.test.ts # Agent chain extraction
```

## Key Implementation Details

- **Entry**: `PromptRecorderPlugin({ client, directory })` async factory in `src/index.ts`
- **Config file** (optional): `<project>/opencode-prompt-tracker.config.json`
- **Hooks**: `chat.message` → `event.message.updated` → `event.session.idle`
- **Output**: Markdown files in `<project>/.opencode/prompts/`

### Config File Schema

```json
{
  "outputPath": ".opencode/prompts",
  "filePrefix": "opencode-prompt-",
  "billing": {
    "enabled": false,
    "models": [
      { "model": "opencode/sonnet-4", "input": 3.75, "output": 15.0, "cacheRead": 0.3, "cacheWrite": 3.75 }
    ]
  }
}
```

## Code Conventions

- **Formatter**: Prettier (`.prettierrc`) — single quotes, semicolons, 2 spaces, 100 char width
- **TypeScript**: Strict mode (`tsconfig.json`)
- **Runtime compatibility**: Both Bun and Node.js — uses `typeof Bun !== 'undefined'` check

## Local Testing

```bash
# 1. Build plugin
npm run build

# 2. Copy to test project
mkdir -p <test-project>/.opencode/plugins/
cp dist/release/opencode-prompt-tracker.js <test-project>/.opencode/plugins/

# 3. Add to opencode.json:
{ "plugin": ["opencode-prompt-tracker"] }
```

## Publishing

```bash
npm version patch  # or minor/major
npm run build
npm publish --access public
```