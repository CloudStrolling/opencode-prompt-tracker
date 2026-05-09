# OpenCode Prompt Tracker Plugin

An OpenCode plugin that automatically records each conversation's prompt, model, agent call chain, duration, and token usage to daily Markdown files.

## Features

- **Automatic Logging**: Records each conversation to Markdown files after completion
- **Agent Chain Tracking**: Records the complete agent call chain (e.g., `oracle → build → explore`)
- **Token Statistics**: Records Input/Output tokens with cached/uncached breakdown
- **Duration Tracking**: Records conversation processing duration
- **Step-by-Step Logging**: Logs each assistant message as it completes
- **Daily Archiving**: Generates log files organized by date
- **Cost Calculation**: Optional billing based on model pricing (when configured)

## Installation

### Method 1: Install via npm (Recommended)

Add the plugin configuration in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-prompt-tracker"]
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
git clone <repository-url> opencode-prompt-tracker
cd opencode-prompt-tracker

# Install dependencies
npm install
# or
bun install

# Build the plugin
npm run build
# or
bun run build

# Copy to OpenCode plugins directory
mkdir -p ~/.opencode/plugins/opencode-prompt-tracker
cp -r dist/* ~/.opencode/plugins/opencode-prompt-tracker/

# Register in opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-prompt-tracker"]
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

## Configuration

Create `opencode-prompt-tracker.config.json` in your project root:

```json
{
  "outputPath": ".opencode/prompts",
  "filePrefix": "opencode-prompt-",
  "billing": {
    "enabled": true,
    "models": [
      {
        "model": "opencode/sonnet-4",
        "input": 3.75,
        "output": 15.0,
        "cacheRead": 0.3,
        "cacheWrite": 3.75
      }
    ]
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `outputPath` | `.opencode/prompts` | Output directory relative to project root |
| `filePrefix` | `opencode-prompt-` | File name prefix |
| `billing.enabled` | `false` | Enable cost calculation |
| `billing.models` | `[]` | Model pricing config (price per 1M tokens) |

When billing is enabled and the model is configured, the summary includes a cost line:

```markdown
- **Cost**: $0.0123 (input: $0.005, output: $0.007, cache: $0.0003)
```

Without a config file, the plugin uses all defaults and works as before.

## Development

### Project Structure

```
opencode-prompt-tracker/
├── src/
│   ├── index.ts              # Main plugin — hook handlers
│   ├── types.ts             # TypeScript interfaces
│   └── utils/
│       ├── file-writer.ts  # Writes .md logs to .opencode/prompts/
│       ├── agent-extractor.ts # Parses agent chain from message parts
│       ├── logger.ts       # Plugin logging to OpenCode console
│       ├── config.ts       # Config loader
│       └── billing.ts     # Cost calculation
├── tests/                   # Test files
├── dist/                   # Build output
├── package.json
├── tsconfig.json
├── README.md               # English README
├── README_CN.md           # Chinese README
├── AGENTS.md              # Developer instructions
└── opencode-prompt-tracker.config.example.json
```

### Developer Commands

```bash
npm run build    # Build TypeScript + esbuild → dist/release/opencode-prompt-tracker.js
npm run dev     # Watch mode: tsc --watch
npm test       # Run tests with Bun (bun test)
```

### Local Testing

```bash
# 1. Build plugin
npm run build

# 2. Copy to test project
mkdir -p <test-project>/.opencode/plugins/
cp dist/release/opencode-prompt-tracker.js <test-project>/.opencode/plugins/

# 3. Add to opencode.json
{ "plugin": ["opencode-prompt-tracker"] }
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

Copyright 2026 OpenCode Prompt Tracker Contributors