# OpenCode Prompt Recorder Plugin — Design Document

## 1. System Architecture Overview

### 1.1 Architecture Pattern
The plugin follows a modular, event-driven architecture using OpenCode's hook system. It operates as a passive observer that captures conversation events without interfering with the core OpenCode functionality.

### 1.2 System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OpenCode Core                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PromptRecorderPlugin (Entry Point)                      │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  sessionStates (Map<string, SessionState>)                         │     │
│  │  - In-memory storage for active sessions                          │     │
│  │  - Maximum 100 sessions (LRU eviction)                            │     │
│  │  - Stores prompt, model, agentChain, accumulated tokens           │     │
│  │  - messageTexts Map for task description collection              │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
│                                    │                                        │
│              ┌─────────────────────┼─────────────────────┐                │
│              │                     │                     │                │
│              ▼                     ▼                     ▼                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐        │
│  │  chat.message    │  │      event       │  │   Utilities      │        │
│  │    Hook          │  │      Hook         │  │                  │        │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘        │
│              │                     │                     │                │
│              └─────────────────────┼─────────────────────┘                │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       Utility Modules                                │   │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐     │   │
│  │  │  file-writer.ts  │ │  config.ts      │ │   billing.ts   │     │   │
│  │  │                  │ │                  │ │                 │     │   │
│  │  │  - Markdown I/O  │ │  - Config loader│ │  - Cost calc    │     │   │
│  │  │  - Step + Summary│ │  - Defaults     │ │  - Model pricing│     │   │
│  │  │  - Directory mgmt│ │  - JSON parse   │ │  - Format output│     │   │
│  │  └─────────────────┘ └─────────────────┘ └─────────────────┘     │   │
│  │  ┌─────────────────┐ ┌─────────────────┐                           │   │
│  │  │agent-extractor.ts│ │   logger.ts     │                           │   │
│  │  │                  │ │                 │                           │   │
│  │  │ - Agent chain    │ │ - Client logging│                           │   │
│  │  │   extraction     │ │ - Fallback file │                           │   │
│  │  │ - Parts parsing │ │                 │                           │   │
│  │  └─────────────────┘ └─────────────────┘                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Output: Markdown Files                           │   │
│  │  <project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<session>.md│  │
│  │  (configurable via opencode-prompt-tracker.config.json)            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module Responsibilities

| Module | Responsibility | Public API |
|--------|----------------|------------|
| `index.ts` | Main plugin entry, hook handlers, session state management, task extraction, thinking collection | `PromptRecorderPlugin()` |
| `types.ts` | TypeScript interfaces for all data structures | Export interfaces |
| `file-writer.ts` | Markdown file I/O, step/summary logging, all-logs file | `appendStepToPromptRecorder()`, `appendToPromptRecorder()`, `appendAllLogsToPromptRecorder()` |
| `config.ts` | Load config file with defaults | `loadConfig()`, `getDefaultConfig()` |
| `billing.ts` | Token cost calculation based on model pricing | `calculateStepCost()`, `formatCostLine()`, `findModelPricing()` |
| `agent-extractor.ts` | Parse message parts for agent information | `extractAgentChain()` |
| `logger.ts` | Logging abstraction with fallback | `initLogger()`, `logInfo()`, `logError()` |

---

## 2. Module Design Details

### 2.1 Main Entry Point (index.ts)

**Purpose**: Plugin factory function that initializes the plugin and returns hook handlers.

**Key Responsibilities**:
1. Initialize logger and config loader
2. Manage session state lifecycle (create, update, cleanup)
3. Handle chat.message hook (session initialization)
4. Handle event hook (text collection, step logging, summary writing)
5. Extract task descriptions from accumulated message text
6. Coordinate between hooks for complete workflow

**Core Functions**:
```typescript
// Main plugin factory
PromptRecorderPlugin({
  client: any,
  directory: string
}): Promise<{
  'chat.message': (input: any, output: any) => Promise<void>,
  event: ({ event }: { event: any }) => Promise<void>
}>
```

**Key Extraction Functions** (in index.ts):
- `extractPromptFromParts()` - Extract user prompt from message parts
- `extractModelFromInput()` - Extract model identifier from input context
- `extractTokens()` - Extract token counts (primary and legacy formats)
- `extractAgentFromInfo()` - Extract agent name with 5-level priority fallback
- `extractTaskDescription()` - Extract brief task description with 5 fallback chains

**Session State Lifecycle**:
```
chat.message (user sends message)
    │
    ▼
Create SessionState with initial data
    │
    ▼
Store in sessionStates Map
    │
    ▼
message.part.updated (accumulate text for task descriptions)
    │
    ▼
message.updated (assistant completes)
    │
    ▼
Write step log, extract task, accumulate tokens
    │
    ▼
session.idle OR session.status (type: idle)
    │
    ▼
Write summary with totals + optional cost
    │
    ▼
Cleanup SessionState from memory
```

### 2.2 Type Definitions (types.ts)

**Purpose**: Define all TypeScript interfaces used throughout the plugin.

**Interfaces Defined**:
1. `MessageStep` - Single assistant message step data (includes taskDescription)
2. `SessionState` - In-memory session tracking with accumulation fields
3. `LogData` - Summary data for writing to file (includes optional costBreakdown)
4. `BillingModelConfig` - Model pricing configuration
5. `BillingConfig` - Billing feature enable/disable + model list
6. `PromptRecorderConfig` - Main plugin configuration
7. `CostBreakdown` - Calculated cost breakdown

**Design Rationale**:
- Separation of in-memory vs. persisted data structures
- Accumulator fields in SessionState for step aggregation
- Read-only LogData for clean write operations
- Optional costBreakdown for conditional billing display

### 2.3 File Writer (file-writer.ts)

**Purpose**: Handle all Markdown file I/O operations.

**Key Functions**:
```typescript
// Write step entry (called per assistant message)
appendStepToPromptRecorder(
  directory: string,
  sessionID: string,
  sessionStartTime: string,
  step: MessageStep,
  isFirstStep: boolean,
  prompt: string,
  outputPath: string,
  filePrefix: string
): Promise<void>

// Write summary entry (called once per session)
appendToPromptRecorder(
  directory: string,
  data: LogData,
  sessionState: SessionState,
  outputPath: string,
  filePrefix: string
): Promise<void>
```

**File Format Design**:
```markdown
# Prompt-Tracker

## Prompt
<user's original prompt>

### Step 1 — 10:30:15
- **Agent**: oracle
- **Model**: opencode/hy3-preview-free
- **Duration**: 12.34s
- **Total Tokens**: 950 (input: 150, output: 800)
- **Cached Tokens**: 100 (read: 0, write: 100)
- **Uncached Tokens**: 50
- **Task**: Analyze the authentication module structure

---

### Summary — 10:30:15
- **Model**: opencode/hy3-preview-free
- **Agent Chain**: oracle → build
- **Total Duration**: 12.34s
- **Steps**: 1
- **Total Tokens**: 950 (input: 150, output: 800)
- **Cached Tokens**: 100 (read: 0, write: 100)
- **Uncached Tokens**: 50
- **Cost**: $0.0123 (input: $0.005, output: $0.007, cache: $0.0003)

---
```

**Runtime Abstraction**:
- Detect runtime via `typeof Bun !== 'undefined'`
- Bun: Use `Bun.file()` API
- Node.js: Use `fs` module
- Both support async operations

### 2.4 Config Loader (config.ts)

**Purpose**: Load and merge configuration with defaults.

**Config File**: `opencode-prompt-tracker.config.json` (in project root)

**Default Configuration**:
```typescript
{
  outputPath: '.opencode/prompts',
  filePrefix: 'opencode-prompt-',
  billing: {
    enabled: false,
    models: []
  }
}
```

**Key Functions**:
```typescript
loadConfig(directory: string): Promise<PromptRecorderConfig>
getDefaultConfig(): PromptRecorderConfig
```

**Design Rationale**:
- Graceful fallback to defaults if config file missing or invalid
- Supports custom output directory and file naming
- Billing is opt-in (disabled by default)

### 2.5 Billing Calculator (billing.ts)

**Purpose**: Calculate token costs based on configured model pricing.

**Pricing Structure** (price per 1M tokens):
```typescript
interface BillingModelConfig {
  model: string;       // Full model name (e.g., 'opencode/sonnet-4')
  input: number;       // Price per 1M input tokens (uncached)
  output: number;      // Price per 1M output tokens
  cacheRead: number;   // Price per 1M cache read tokens
  cacheWrite: number;  // Price per 1M cache write tokens
}
```

**Cost Calculation Formula**:
```
inputCost = (inputTokens - cacheRead - cacheWrite) / 1M * pricing.input
outputCost = outputTokens / 1M * pricing.output
cacheCost = (cacheRead / 1M * pricing.cacheRead) + (cacheWrite / 1M * pricing.cacheWrite)
totalCost = inputCost + outputCost + cacheCost
```

**Key Functions**:
```typescript
calculateStepCost(model, inputTokens, outputTokens, cacheRead, cacheWrite, pricing): CostBreakdown | null
formatCostLine(cost: CostBreakdown): string
findModelPricing(model: string, models: BillingModelConfig[]): BillingModelConfig | null
```

### 2.6 Agent Extractor (agent-extractor.ts)

**Purpose**: Extract agent names from OpenCode message parts.

**Extraction Logic**:
```typescript
extractAgentChain(parts: any[]): string[]
```

**Algorithm**:
1. Iterate through all parts in the array
2. Match `part.type === 'agent'` → extract `part.name`
3. Match `part.type === 'subtask'` → extract `part.agent`
4. Return array of agent names in order of appearance

**Design Rationale**:
- Simple, focused function for single responsibility
- No external dependencies
- Returns array for easy merging with other sources

### 2.7 Logger (logger.ts)

**Purpose**: Provide logging abstraction with dual output paths.

**Design Pattern**: Decorator pattern with fallback

```
Primary: client.app.log() → OpenCode console
    │
    │ (on failure)
    ▼
Fallback: Write to .opencode/prompts/.plugin-log
```

**Key Functions**:
```typescript
initLogger(client: any, directory: string): void
logInfo(message: string, extra?: any): Promise<void>
logError(message: string, extra?: any): Promise<void>
```

**Error Handling**: Silent failure - logging errors should not break plugin functionality.

### 2.8 All Logs Feature (file-writer.ts + index.ts)

**Purpose**: Capture complete conversation logs including thinking/reasoning content.

**Key Functions**:
```typescript
// In file-writer.ts
formatAllLogsEntry(data: AllLogsData): string
appendAllLogsToPromptRecorder(directory, sessionID, sessionStartTime, data, outputPath): Promise<void>

// In index.ts - SessionState additions
allUserInputs: string[]           // Collected user inputs
allUserInputTimes: string[]        // Timestamps for user inputs
allAssistantOutputs: string[]       // Collected assistant outputs (with thinking)
allAssistantOutputTimes: string[]  // Timestamps for assistant outputs
allLogsFilePath: string | null     // Log file path
```

**Output Format**:
```markdown
# All Logs

## Session: <sessionID>
**Start:** <time> | **End:** <time>

---

### User Input #1 — 10:30:15
```
[user message]
```

---

### Assistant Output #1 — 10:30:16
```
[thinking content]
[assistant response]
```

---
```

**Flow**:
1. `chat.message` → Collect user input + timestamp
2. `message.part.updated` (thinking) → Collect to thinking buffer
3. `message.part.updated` (text) → Collect to response buffer
4. `message.updated` → Combine thinking + response, store in session
5. `session.idle` → Write all-logs file (if `saveAllLogs: true`)

### 2.9 Thinking/Reasoning Content Collection (index.ts)

**Purpose**: Extract task descriptions from thinking/reasoning content.

**Key Functions**:
```typescript
extractTaskDescription(text, info, thinkingText): string
extractMeaningfulLineFromThinking(thinkingText): string
```

**Algorithm**:
1. Try first non-empty line from accumulated text
2. Try meaningful line from thinking content (often ends with summary)
3. Try info metadata fields
4. Try AI response content structure
5. Final fallback: Use first segment of assistant's reply

---

## 3. Data Flow Design

### 3.1 Complete Data Flow

```
┌──────────────┐     chat.message     ┌──────────────┐
│   User       │ ─────────────────────▶│   Plugin     │
│   sends      │                      │   receives   │
│   message    │                      │   input+     │
└──────────────┘                      │   output     │
                                       └──────┬───────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ Extract:        │                │                         │
          │ - prompt        │                │                         │
          │ - model         │                │                         │
          │ - agentChain    │                │                         │
          │ - startTime     │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ Create          │                │                         │
          │ SessionState    │                │                         │
          │ in memory       │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   │                    message.part.updated           │
                   │◀──────────────────────────────────────────────────│
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ Accumulate      │                │                         │
          │ text content    │                │                         │
          │ per step        │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   │                    message.updated                │
                   │◀─────────────────────────────────────────────────│
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ Event Handler:  │                │                         │
          │ - Validate      │                │                         │
          │   completion    │                │                         │
          │ - Extract tokens│                │                         │
          │ - Extract task  │                │                         │
          │ - Write step    │                │                         │
          │ - Accumulate    │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   │                    session.idle OR                │
                   │                    session.status (idle)         │
                   │◀─────────────────────────────────────────────────│
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ Write Summary:  │                │                         │
          │ - Calculate    │                │                         │
          │   duration     │                │                         │
          │ - Aggregate    │                │                         │
          │   tokens       │                │                         │
          │ - Calculate    │                │                         │
          │   cost (if en) │                │                         │
          │ - Write file   │                │                         │
          │ - Cleanup mem  │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ .opencode/       │                │                         │
          │ prompts/         │                │                         │
          │ (or custom path) │                │                         │
          └─────────────────┘                │                         │
                                              │                         │
                                              ▼
                                    ┌─────────────────┐
                                    │   User views    │
                                    │   log file      │
                                    └─────────────────┘
```

### 3.2 Token Extraction Flow

```
Assistant Message Info
        │
        ▼
┌───────────────────┐
│ Has info.tokens? │──Yes──▶ Use primary structure
└────────┬──────────┘            (input, output, cache, reasoning)
         │ No
         ▼
┌───────────────────┐
│ Has info.usage?   │──Yes──▶ Use legacy structure
└────────┬──────────┘            (prompt_tokens, completion_tokens, cache_*)
         │ No
         ▼
┌───────────────────┐
│ Skip this event   │ (wait for next event with token data)
└───────────────────┘
```

### 3.3 Task Description Extraction Flow

```
message.part.updated (text accumulation)
        │
        ▼
┌───────────────────┐
│ Append text to   │
│ messageTexts Map │
│ Key: step-${n}   │
└────────┬──────────┘
         │
message.updated (step completion)
         │
         ▼
┌───────────────────┐
│ Extract task desc │
│ from accumulated │
│ text + info      │
│ (5-level fallback)│
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ Write step with   │
│ task description  │
└───────────────────┘
```

### 3.4 All Logs Flow

```
chat.message (user sends message)
         │
         ▼
Collect user input + timestamp
         │
message.part.updated (thinking/reasoning)
         │
         ▼
Accumulate thinking content in separate buffer
         │
message.part.updated (text response)
         │
         ▼
Combine thinking + text into complete assistant output
         │
         ▼
Store combined output + timestamp in session
         │
session.idle (session ends)
         │
         ▼
Write all-logs file (if saveAllLogs enabled)
         │
         ▼
.opencode/prompts/opencode-prompt-log-YYYY-MM-DD_<sessionID>.md
```

### 3.5 Thinking Content Flow

```
message.part.updated (type: 'thinking' or 'reasoning')
         │
         ▼
Key: step-thinking-<n>
         │
         ▼
Accumulate thinking text in messageTexts Map
         │
message.updated (step completes)
         │
         ▼
extractTaskDescription(combinedText, info, thinkingText)
         │
         ▼
Try meaningful line from thinking (often last few lines)
         │
         ▼
If found: Use as task description
If not: Fall back to other extraction methods
```

### 4.1 Plugin Factory API

```typescript
// Input parameters
interface PluginConfig {
  client: any;      // OpenCode client instance
  directory: string;  // Project directory path
}

// Output: Hook handlers
interface PluginHooks {
  'chat.message': (input: any, output: any) => Promise<void>;
  event: ({ event }: { event: any }) => Promise<void>;
}
```

### 4.2 Configuration File API

**Config File**: `opencode-prompt-tracker.config.json`

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

### 4.3 Hook Input/Output Schemas

#### chat.message Hook

**Input (input)**:
```typescript
{
  sessionID: string;
  model: {
    providerID: string;
    modelID: string;
  } | string;
  agent: string;
}
```

**Input (output)**:
```typescript
{
  message: {
    id: string;
  };
  parts: Array<{
    type: 'text' | 'agent' | 'subtask' | ...;
    text?: string;
    name?: string;
    agent?: string;
  }>;
}
```

#### event Hook

**Input (event)**:
```typescript
{
  type: 'message.part.updated' | 'message.updated' | 'session.idle' | 'session.status';
  properties: {
    part?: {
      type: string;
      text: string;
      sessionID: string;
    };
    info?: {
      id: string;
      sessionID: string;
      role: 'assistant';
      time?: { completed: boolean };
      tokens?: { input, output, context, cache: { read, write }, reasoning };
      usage?: { prompt_tokens, completion_tokens, ... };
      providerID?: string;
      modelID?: string;
      agent?: string | { name: string };
    };
    sessionID?: string;
    status?: { type: 'idle' };
  };
}
```

---

## 5. Edge Case Handling Design

### 5.1 Race Condition Prevention

**Problem**: In fast agent workflows, multiple message.updated events may fire rapidly.

**Solution**: Use `completedMessageIDs` Set to track processed messages.
```typescript
if (state.completedMessageIDs.has(messageID)) {
  return; // Skip already processed
}
state.completedMessageIDs.add(messageID);
```

### 5.2 Incomplete Data Handling

**Problem**: Completion flag may be set before token data is available.

**Solution**: Dual validation - check BOTH completion flag AND token availability.
```typescript
const isComplete = info.time?.completed;
const hasFullTokens = primaryTokens && primaryTokens.input > 0 && ...;
const hasUsageTokens = info.usage && ...;

if (!isComplete || (!hasFullTokens && !hasUsageTokens)) {
  return; // Wait for next event
}
```

### 5.3 Memory Pressure Handling

**Problem**: Long-running sessions with many steps could consume excessive memory.

**Solution**: LRU-style eviction after 100 sessions.
```typescript
if (sessionStates.size > 100) {
  const firstKey = sessionStates.keys().next().value;
  if (firstKey) sessionStates.delete(firstKey);
}
```

### 5.4 File System Errors

**Problem**: Disk full, permission denied, or concurrent write conflicts.

**Solution**: Try-catch with error logging, no re-throwing to prevent plugin crash.
```typescript
try {
  // file operations
} catch (error) {
  await logError('Failed to write', { error: String(error) });
  // Silent return - plugin continues functioning
}
```

### 5.5 Task Description Extraction

**Problem**: Assistant response may not contain clear task description in expected format.

**Solution**: 5-level fallback chain:
1. First meaningful line from accumulated text
2. Task/description fields from info metadata
3. Content structure fields from info
4. First line from AI response content
5. First segment of assistant's reply content

### 5.6 Agent Name Extraction

**Problem**: Different event types use different fields for agent name.

**Solution**: 5-level priority fallback:
1. `info.agent` (direct string)
2. `info.agent.name` (object with name)
3. `info.name` (some events)
4. `info.agentInfo.name`
5. `info.providerID` (filtered)
6. Parts array (agent/subtask types)

---

## 6. Configuration Design

### 6.1 Configuration File

**Location**: `<project>/opencode-prompt-tracker.config.json`

**Schema**:
```typescript
interface PromptRecorderConfig {
  outputPath: string;      // Relative path from project root
  filePrefix: string;      // File name prefix
  saveAllLogs: boolean;   // Enable complete conversation logging
  billing: BillingConfig;  // Billing feature config
}
```

### 6.2 Default Values

| Field | Default | Description |
|-------|---------|-------------|
| `outputPath` | `.opencode/prompts` | Output directory relative to project root |
| `filePrefix` | `opencode-prompt-` | File name prefix |
| `saveAllLogs` | `false` | Enable complete conversation capture |
| `billing.enabled` | `false` | Enable cost calculation |
| `billing.models` | `[]` | Model pricing config |

### 6.3 Billing Configuration

**Purpose**: Calculate token costs based on model pricing (price per 1M tokens).

**When Enabled**:
- Summary log includes cost line
- Only applies if model matches a configured model
- Falls back gracefully if model not found

---

## 7. Security Considerations

### 7.1 Data Privacy
- Logs contain user prompts - consider who has access to .opencode/prompts/ directory
- No sensitive data filtering (user responsibility to sanitize if needed)
- Local file storage only, no network transmission

### 7.2 File Access
- Plugin writes to project .opencode/prompts/ subdirectory (or custom path)
- No access to files outside the designated log directory
- Compatible with standard file permission models

### 7.3 Config File Security
- Config file location is project-scoped (each project has own config)
- No sensitive information should be stored in config (model pricing is public)

---

## 8. Performance Optimization

### 8.1 Async File Operations
- All file I/O is asynchronous (non-blocking)
- Bun: Native async file API
- Node.js: async fs methods

### 8.2 String Concatenation
- Pre-allocate content strings where possible
- Use template literals for formatting
- Minimal string allocations in hot paths

### 8.3 Memory Efficiency
- SessionState uses Set for O(1) membership checks
- messageTexts Map uses step number as key for text accumulation
- Maximum 100 sessions hard limit
- Cleanup on session end prevents memory leaks

### 8.4 Config Caching
- Config loaded once at plugin initialization
- Stored in memory for entire plugin lifecycle
- No repeated file reads

---

## 9. Testing Strategy

### 9.1 Unit Tests
- agent-extractor.ts - Agent chain extraction logic
- file-writer.ts - Markdown formatting (mock fs)
- billing.ts - Cost calculation accuracy
- config.ts - Default merging and file loading

### 9.2 Integration Tests
- Full plugin lifecycle (mock OpenCode hooks)
- File output verification
- Multiple step handling
- Config file loading

### 9.3 Manual Testing
- Real OpenCode session capture
- Log file content verification
- Edge case exploration
- Billing calculation verification

---

## 10. Configuration and Extension Points

### 10.1 Build Configuration
- TypeScript compilation with strict mode
- esbuild bundling for distribution
- Output: ESM format for Bun/Node compatibility

### 10.2 Extension Points (Future)
- Custom log format templates
- Additional metadata fields
- Webhook notifications
- Export format options (JSON, CSV)
- Database storage backend