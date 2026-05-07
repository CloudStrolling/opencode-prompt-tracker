# OpenCode Prompt Log Plugin

An OpenCode plugin that records prompts, models, agent call chains, duration, and token usage for each conversation into daily Markdown files.

## Features

- 📝 **Automatic Logging**: Automatically records each conversation to Markdown files after the conversation ends
- 🔗 **Agent Chain Tracking**: Records the complete agent call chain (e.g., `oracle → build → explore`), including both the first-called agent and sub-agents invoked through other agents
- 💰 **Token Statistics**: Records Input/Output Tokens, with separate context token counting
- ⏱️ **Duration Tracking**: Records the duration of each conversation
- 📅 **Daily Archiving**: Automatically generates log files by date

## Installation

### Method 1: Install via npm (Recommended)

1. Add the plugin configuration in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-prompt-log"]
}
```

2. Restart OpenCode, and the plugin will be automatically downloaded and installed.

> **Note**: The plugin will be installed to `~/.cache/opencode/node_modules/` directory, which is the standard location for OpenCode to manage npm plugins.

### Method 2: Local Installation (Development/Debugging)

Suitable for users who need to modify the plugin or participate in development.

#### Prerequisites

- OpenCode editor
- Node.js 18+ or Bun runtime

#### Installation Steps

1. Clone or download this plugin to local:

```bash
git clone <repository-url> opencode-prompt-log
cd opencode-prompt-log
```

2. Install dependencies:

```bash
npm install
# or
bun install
```

3. Build the plugin:

```bash
npm run build
# or
bun run build
```

4. Copy the plugin to the OpenCode plugins directory:

```bash
# The plugin directory location depends on your OpenCode configuration
# Usually it's ~/.opencode/plugins/ or <project-directory>/.opencode/plugins/
mkdir -p ~/.opencode/plugins/opencode-prompt-log
cp -r dist/* ~/.opencode/plugins/opencode-prompt-log/
```

5. Register the plugin in OpenCode configuration:

Edit the `opencode.json` file in your project root or user home directory, add `"opencode-prompt-log"` to the `plugin` array:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-prompt-log"
  ]
}
```

If the `plugin` array already has other plugins, simply append:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-browser",
    "opencode-prompt-log"
  ]
}
```

## Usage

After installation and restarting OpenCode, the plugin will automatically activate. After each conversation ends, the plugin will:

1. Capture user messages in the `chat.message` hook, recording prompt and model information
2. Capture assistant responses in the `message.updated` hook, recording duration and token usage
3. Write the information to `<project-directory>/.opencode/prompts/opencode-prompt-YYYY-MM-DD.md`

### Log File Format

Log files use Markdown table format:

```markdown
| Time | Agent Chain | Model | Prompt | Duration(s) | Input Tokens | Output Tokens | Context Tokens | Cache Read | Cache Write |
|------|-------------|-------|--------|-------------|--------------|---------------|-----------------|------------|-------------|
| 10:30:15 | oracle → build | opencode/hy3-preview-free | Design an OpenCode plugin... | 12.34 | 150 | 800 | 100 | 0 | 0 |
```

### Field Description

| Field | Description |
|-------|-------------|
| Time | Conversation start time (HH:MM:SS) |
| Agent Chain | Complete agent call chain, e.g., `main → code-review → test` |
| Model | AI model used, e.g., `opencode/hy3-preview-free` |
| Prompt | User input prompt (newlines replaced with `<br>`) |
| Duration(s) | Conversation processing duration in seconds |
| Input Tokens | Total input Token count |
| Output Tokens | Output Token count |
| Context Tokens | Context Token count (separated from total input) |
| Cache Read | Tokens read from cache |
| Cache Write | Tokens written to cache |

## Development

### Project Structure

```
opencode-prompt-log/
├── src/
│   ├── index.ts              # Plugin entry point
│   ├── types.ts              # Type definitions
│   ├── hooks/
│   │   ├── chat-message.ts  # chat.message hook handler
│   │   └── message-updated.ts  # message.updated hook handler
│   └── utils/
│       ├── file-writer.ts   # File writer utility
│       └── agent-extractor.ts  # Agent chain extractor utility
├── tests/                   # Test files
├── dist/                    # Build output
├── package.json
├── tsconfig.json
├── README.md               # English README
└── README_CM.md            # Chinese README
```

### Local Build

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Watch mode for development
npm run dev
```

### Run Tests

```bash
npm test
# or
bun test
```

### Local Installation Testing

```bash
# 1. Build the plugin
npm run build

# 2. Copy to test project's plugin directory
mkdir -p <test-project>/.opencode/plugins/
cp dist/index.js <test-project>/.opencode/plugins/prompt-log.js

# 3. Start OpenCode in the test project
cd <test-project>
opencode
```

## npm Publishing Process

### Preparation

1. Ensure `package.json` information is correct:
   - `name`: Package name (must be `opencode-prompt-log`)
   - `version`: Version number
   - `main`: Entry file (`dist/release/opencode-prompt-log.js`)
   - `files`: Files to include for publishing (`dist/`, `README.md`, `README_CM.md`, `LICENSE`)

2. Ensure `README.md`, `README_CM.md`, and `LICENSE` files exist

### Build and Publish

```bash
# 1. Login to npm (required for first publish)
npm login

# 2. Install dependencies and build
npm install
npm run build

# 3. Publish to npm
npm publish

# If it's a scoped package (e.g., @username/opencode-prompt-log), add --access public
npm publish --access public
```

### Version Update

When releasing a new version:

```bash
# 1. Update version number (patch/minor/major)
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.0 -> 1.1.0
npm version major  # 1.0.0 -> 2.0.0

# 2. Build
npm run build

# 3. Publish
npm publish
```

### Verify Publishing

After publishing, you can view the package information on [npm website](https://www.npmjs.com/package/opencode-prompt-log), or verify with:

```bash
npm view opencode-prompt-log
```

## Technical Details

- **Hooks**: Uses `chat.message` and `message.updated` hooks to capture conversations
- **Data Storage**: Uses Markdown table format for easy reading and searching
- **Compatibility**: Supports both new Plugin API and legacy activate API
- **Runtime**: Supports both Bun and Node.js runtimes
- **Type Safety**: Written in TypeScript with complete type definitions

## Troubleshooting

### Plugin Not Loaded

1. Check if the plugin is correctly installed in the OpenCode plugins directory
2. Check if the OpenCode console shows `[PromptLog] Plugin activated` log
3. Confirm that `dist/release/opencode-prompt-log.js` file has been generated

### Log File Not Generated

1. Check if `.opencode/prompts/` directory exists in the project directory and has write permissions
2. Check if there are error messages in the OpenCode console
3. Confirm there is at least one complete user-assistant interaction in the conversation

### TypeScript Compilation Errors

If you encounter build errors, try:

```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

## License

This project is licensed under the Apache License 2.0. See [LICENSE](./LICENSE) file for details.

Copyright 2026 OpenCode Prompt Log Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

## Contributing

Contributions, issues and pull requests are welcome!