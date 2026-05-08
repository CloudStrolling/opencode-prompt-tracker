# OpenCode Prompt Recorder Plugin

An OpenCode plugin that automatically records each conversation's prompt, model, agent call chain, duration, and token usage to daily Markdown files.

## Features

- **Automatic Logging**: Records each conversation to Markdown files after completion
- **Agent Chain Tracking**: Records the complete agent call chain (e.g., `oracle → build → explore`)
- **Token Statistics**: Records Input/Output tokens with cached/uncached breakdown
- **Duration Tracking**: Records conversation processing duration
- **Step-by-Step Logging**: Logs each assistant message as it completes
- **Daily Archiving**: Generates log files organized by date

## Installation

### Method 1: Install via npm (Recommended)

Add the plugin configuration in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-prompt-recorder"]
}
```

Restart OpenCode, and the plugin will be automatically downloaded and installed.

> **Note**: The plugin is installed to `~/.cache/opencode/node_modules/` directory.

### Method 2: Local Installation (Development)

Suitable for modifying the plugin or contributing to development.

#### Prerequisites

- OpenCode editor
- Node.js 18+ or Bun runtime

#### Installation Steps

```bash
# Clone the plugin
git clone <repository-url> opencode-prompt-recorder
cd opencode-prompt-recorder

# Install dependencies
npm install
# or
bun install

# Build the plugin
npm run build
# or
bun run build

# Copy to OpenCode plugins directory
mkdir -p ~/.opencode/plugins/opencode-prompt-recorder
cp -r dist/* ~/.opencode/plugins/opencode-prompt-recorder/

# Register in opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-prompt-recorder"]
}
```

## Usage

After installation, the plugin automatically activates. It captures:

1. User messages via `chat.message` hook — records prompt, model, agent chain
2. Assistant responses via `event.message.updated` — logs each step immediately
3. Session completion via `event.session.idle` — writes final summary

Output is written to `<project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md`

### Log File Format

```markdown
# Prompt Recorder - Session

### Prompt
Design an OpenCode plugin that logs prompts...

### Step 1 — 10:30:15
- **Agent**: oracle
- **Model**: opencode/hy3-preview-free
- **Duration**: 12.34s
- **Total Tokens**: 950 (input: 150, output: 800)
- **Cached Tokens**: 100 (read: 0, write: 100)
- **Uncached Tokens**: 50
- **Task**: Analyze the authentication module structure

---

## Summary — 10:30:15
- **Model**: opencode/hy3-preview-free
- **Agent Chain**: oracle → build
- **Total Duration**: 12.34s
- **Steps**: 1
- **Total Tokens**: 950 (input: 150, output: 800)
- **Cached Tokens**: 100 (read: 0, write: 100)
- **Uncached Tokens**: 50

---
```

### Field Description

| Field | Description |
|-------|-------------|
| Time | Conversation start time (HH:MM:SS) |
| Agent Chain | Complete agent call chain, e.g., `main → code-review → test` |
| Model | AI model used, e.g., `opencode/hy3-preview-free` |
| Prompt | User's original input text |
| Duration(s) | Conversation processing duration in seconds |
| Input Tokens | Total input token count (includes cached portions) |
| Output Tokens | Output token count |
| Cached Tokens | Total cache read + write tokens |
| Uncached Tokens | Input tokens minus cached tokens |
| Cache Read | Tokens read from cache (billed at discount) |
| Cache Write | Tokens written to cache (billed at premium) |

## Development

### Project Structure

```
opencode-prompt-recorder/
├── src/
│   ├── index.ts              # Main plugin — hook handlers
│   ├── types.ts             # TypeScript interfaces
│   └── utils/
│       ├── file-writer.ts  # Writes .md logs to .opencode/prompts/
│       ├── agent-extractor.ts # Parses agent chain from message parts
│       └── logger.ts       # Plugin logging to OpenCode console
├── tests/                   # Test files
├── dist/                    # Build output
├── package.json
├── tsconfig.json
├── README.md               # English README
├── README_CN.md           # Chinese README
└── AGENTS.md              # Developer instructions
```

### Developer Commands

```bash
npm run build    # Build TypeScript + esbuild → dist/release/opencode-prompt-recorder.js
npm run dev     # Watch mode: tsc --watch
npm test        # Run tests with Bun (bun test)
```

### Local Testing

```bash
# 1. Build plugin
npm run build

# 2. Copy to test project
mkdir -p <test-project>/.opencode/plugins/
cp dist/release/opencode-prompt-recorder.js <test-project>/.opencode/plugins/

# 3. Add to opencode.json
{ "plugin": ["opencode-prompt-recorder"] }
```

## Publishing

```bash
# Update version (patch/minor/major)
npm version patch

# Build
npm run build

# Publish
npm publish
# For scoped packages:
npm publish --access public
```

## Technical Details

- **Hooks**: `chat.message`, `event.message.part.updated`, `event.message.updated`, `event.session.idle`
- **Data Storage**: Markdown format with step entries + summary
- **Runtime**: Supports both Bun and Node.js
- **Type Safety**: TypeScript with strict mode

## License

Licensed under the Apache License 2.0. See [LICENSE](./LICENSE) file for details.

Copyright 2026 OpenCode Prompt Recorder Contributors