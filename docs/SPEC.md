# OpenCode Prompt Tracker Plugin - Specification

## 1. Project Overview

### Project Name
OpenCode Prompt Tracker Plugin

### Project Type
OpenCode Plugin (TypeScript/JavaScript)

### Core Feature Summary
An OpenCode plugin that automatically records each conversation's prompt, model, agent call chain, duration, and token usage to daily Markdown files.

### Target Users
- OpenCode users who want to track their AI usage
- Developers who need to analyze conversation patterns
- Teams monitoring token consumption and costs

---

## 2. Functional Requirements

### 2.1 Core Features

#### F1: Automatic Conversation Logging
- **Description**: Automatically record each user-assistant conversation to Markdown files after the conversation ends
- **Trigger**: When assistant message is complete with token stats available
- **Output**: Write to `<project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md`

#### F2: Agent Chain Tracking
- **Description**: Record the complete agent call chain (e.g., `oracle → build → explore`)
- **Scope**: Include both the first-called agent and sub-agents invoked through other agents
- **Data Source**: Extract from `input.agent` and `output.parts` (agent/subtask types)

#### F3: Token Statistics
- **Description**: Record detailed token usage information
- **Fields**:
  - Input Tokens: Total input token count
  - Output Tokens: Total output token count
  - Context Tokens: Context token count (separated from total input)
  - Cache Read: Tokens read from cache
  - Cache Write: Tokens written to cache
- **Data Sources**:
  - Primary: `info.tokens` structure (input, output, cache)
  - Fallback: `info.usage` structure (prompt_tokens, completion_tokens, etc.)

#### F4: Duration Tracking
- **Description**: Record the processing duration of each conversation
- **Calculation**: End time - Start time (in seconds, fixed to 2 decimal places)
- **Start Time**: Captured when user sends message (`chat.message` hook)
- **End Time**: Captured when assistant response completes (`message.updated` event)

#### F5: Daily File Archiving
- **Description**: Automatically generate log files organized by date
- **File Naming**: `opencode-prompt-YYYY-MM-DD_<sessionID>.md`
- **Session Handling**: Multiple turns in the same session append to the same file

### 2.2 User Interactions

#### Hook: chat.message
- **Purpose**: Capture user messages when sent
- **Actions**:
  1. Extract prompt text from `output.parts`
  2. Extract model information from `input.model`
  3. Build initial agent chain from `input.agent`
  4. Extract additional agents from `output.parts`
  5. Store session state in memory (sessionStates Map)
  6. Memory management: Keep most recent 100 sessions

#### Hook: event
- **Purpose**: Monitor assistant message completion
- **Event Types Handled**:
  - `message.part.updated`: Accumulate incremental text (future use)
  - `message.updated`: Process assistant completion
- **Completion Check**:
  - Check `info.time?.completed` or `info.finish`
  - Ensure token stats are available (`hasTokens`)
  - Wait for both conditions before logging

### 2.3 Data Structures

#### SessionState (In-Memory)
```typescript
interface SessionState {
  userMsgID: string;      // User message ID
  prompt: string;         // User's prompt text
  model: string;          // AI model identifier
  startTime: number;      // Unix timestamp (ms)
  agentChain: string[];   // Agent call chain
  sessionStartTime: string; // Date string (YYYY-MM-DD)
}
```

#### LogData (For Writing)
```typescript
interface LogData {
  sessionID: string;      // Session identifier
  time: string;           // Formatted time (HH:MM:SS)
  agentChain: string;     // Agent chain (arrow-separated)
  model: string;          // AI model identifier
  prompt: string;         // User's prompt
  duration: string;       // Duration in seconds
  inputTokens: number;    // Input token count
  outputTokens: number;   // Output token count
  contextTokens: number;  // Context token count
  cacheRead: number;      // Cache read tokens
  cacheWrite: number;     // Cache write tokens
}
```

### 2.4 Edge Cases

1. **Long Responses**: Plugin waits for token stats before writing (not just completion flag)
2. **Memory Management**: Maximum 100 sessions stored in memory, oldest removed when exceeded
3. **No Session State**: Skip logging if session state not found (may have been cleaned up)
4. **Missing Tokens**: Skip logging and wait for next event if token data unavailable
5. **File Creation**: Automatically create `.opencode/prompts/` directory if not exists
6. **Model Format**: Support both object format (providerID/modelID) and string format
7. **Runtime Compatibility**: Support both Bun and Node.js runtimes

---

## 3. Non-Functional Requirements

### 3.1 Performance
- Minimal impact on OpenCode response time
- Asynchronous file writing (non-blocking)
- Efficient memory usage (max 100 sessions)

### 3.2 Reliability
- Error handling for file write failures
- Fallback logging to file when OpenCode client logging unavailable
- Session state cleanup after successful logging

### 3.3 Compatibility
- OpenCode Plugin API (new)
- Legacy activate API (fallback)
- Bun runtime (primary)
- Node.js runtime (fallback)
- TypeScript with full type definitions

---

## 4. System Architecture

### 4.1 Module Structure

```
opencode-prompt-tracker/
├── src/
│   ├── index.ts              # Main plugin entry, hook handlers
│   ├── types.ts              # TypeScript interfaces
│   └── utils/
│       ├── file-writer.ts   # Markdown file writing
│       ├── agent-extractor.ts # Agent chain extraction
│       └── logger.ts         # Logging utility
├── dist/                     # Build output
├── package.json              # NPM configuration
└── README.md                 # Documentation
```

### 4.2 Data Flow

```
User sends message (chat.message)
         ↓
Extract prompt, model, agent chain
         ↓
Store SessionState in memory
         ↓
Assistant responds (message.updated event)
         ↓
Check completion + token availability
         ↓
Extract token stats, calculate duration
         ↓
Write to Markdown file
         ↓
Clean up SessionState from memory
```

### 4.3 Key Functions

| Function | Responsibility |
|----------|----------------|
| `PromptRecorderPlugin()` | Main plugin factory, returns hooks |
| `chat.message` hook | Capture user message, store session state |
| `event` hook | Monitor completion, write log entry |
| `extractPromptFromParts()` | Extract text from message parts |
| `extractModelFromInput()` | Extract model identifier |
| `extractAgentChain()` | Extract agent names from parts |
| `appendToPromptRecorder()` | Write log entry to Markdown file |
| `formatLogEntry()` | Format data as Markdown |
| `initLogger()` | Initialize logging system |
| `logInfo()` / `logError()` | Log messages with fallback |

---

## 5. Output Format

### Markdown Log File Format

```markdown
# Prompt Recorder - Session

## 10:30:15

- **Model**: opencode/hy3-preview-free
- **Agent Chain**: oracle → build
- **Duration**: 12.34s
- **Input Tokens**: 150
- **Output Tokens**: 800
- **Context Tokens**: 100
- **Cache Read**: 0
- **Cache Write**: 0

### Prompt
Design an OpenCode plugin that logs prompts...

---
```

### Field Descriptions

| Field | Description |
|-------|-------------|
| Time | Conversation start time (HH:MM:SS) |
| Model | AI model identifier |
| Agent Chain | Complete agent call chain (arrow-separated) |
| Duration | Processing duration in seconds |
| Input Tokens | Total input token count |
| Output Tokens | Total output token count |
| Context Tokens | Context token count (from input) |
| Cache Read | Tokens read from cache |
| Cache Write | Tokens written to cache |
| Prompt | User's original input text |

---

## 6. Acceptance Criteria

### AC1: Basic Logging
- [ ] Each conversation is logged to a Markdown file
- [ ] File is created in `.opencode/prompts/` directory
- [ ] File naming follows pattern `opencode-prompt-YYYY-MM-DD_<sessionID>.md`

### AC2: Data Completeness
- [ ] All 9 fields are recorded (time, model, agentChain, prompt, duration, tokens x5)
- [ ] Token counts match actual usage
- [ ] Duration is accurately calculated

### AC3: Agent Chain
- [ ] Primary agent from input context is captured
- [ ] Sub-agents from message parts are captured
- [ ] Agent chain is formatted as arrow-separated string

### AC4: Completion Handling
- [ ] Plugin waits for both completion flag AND token availability
- [ ] Long responses are logged correctly with full token stats
- [ ] No premature logging with incomplete data

### AC5: Error Handling
- [ ] File write failures are caught and logged
- [ ] Plugin does not crash OpenCode on errors
- [ ] Memory is properly cleaned up after logging

### AC6: Compatibility
- [ ] Works with Bun runtime
- [ ] Works with Node.js runtime
- [ ] TypeScript compiles without errors

---

## 7. Future Enhancements (Out of Scope)

1. JSON export format option
2. Webhook notifications on new logs
3. Log aggregation dashboard
4. Cost calculation based on token pricing
5. Session comparison and analytics
6. Filter/search functionality in log files