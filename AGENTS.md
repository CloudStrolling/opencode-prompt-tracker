# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-09
**Project:** OpenCode Prompt Tracker Plugin

## OVERVIEW

OpenCode plugin that logs prompts, models, agents, duration, and token usage to daily Markdown files.

## STRUCTURE

```
src/
├── index.ts              # Main plugin — PromptRecorderPlugin factory + hooks
├── types.ts              # TypeScript interfaces
└── utils/                # Utility modules (see src/utils/AGENTS.md)

tests/                    # Bun test suite
dist/release/             # Built output (esbuild bundle)
```

## CODE MAP

| Symbol | Type | Location |
|--------|------|----------|
| `PromptRecorderPlugin` | function | src/index.ts:355 |
| `SessionState` | interface | src/types.ts:45 |
| `MessageStep` | interface | src/types.ts:10 |
| `LogData` | interface | src/types.ts:138 |
| `appendStepToPromptRecorder` | function | src/utils/file-writer.ts:115 |
| `loadConfig` | function | src/utils/config.ts:28 |

## HOOKS

| Hook | Purpose |
|------|---------|
| `chat.message` | Capture user input, init session state |
| `event: message.part.updated` | Collect text for task descriptions |
| `event: message.updated` | Write step log when assistant completes |
| `event: session.idle` | Write summary with totals |

## COMMANDS

```bash
npm run build    # tsc → dist/ + esbuild → dist/release/opencode-prompt-tracker.js
npm run dev      # Watch mode: tsc --watch
npm test         # Bun test suite (bun test)
npm publish       # npm version patch && npm run build && npm publish --access public
```

## CONVENTIONS (THIS PROJECT)

- **Formatter**: Prettier — single quotes, semicolons, 2 spaces, 100 char width
- **TypeScript**: Strict mode (`tsconfig.json`)
- **Runtime**: Bun + Node.js dual support via `typeof Bun !== 'undefined'`
- **Build order**: `tsc` → `dist/`, then `esbuild` → `dist/release/`

## LOCAL TESTING

```bash
# Build → Copy → Add to opencode.json
npm run build
cp dist/release/opencode-prompt-tracker.js <test-project>/.opencode/plugins/
# Then add: { "plugin": ["opencode-prompt-tracker"] } in opencode.json
```

## NOTES

- Config file: `<project>/opencode-prompt-tracker.config.json` (optional)
- Output: `<project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md`
- Session cleanup: auto on idle, max 100 concurrent sessions in memory