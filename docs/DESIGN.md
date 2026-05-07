# OpenCode Prompt Log Plugin — Design Document

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
│                      PromptLogPlugin (Entry Point)                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  sessionStates (Map<string, SessionState>)                         │   │
│  │  - In-memory storage for active sessions                          │   │
│  │  - Maximum 100 sessions (LRU eviction)                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│              ┌─────────────────────┼─────────────────────┐               │
│              │                     │                     │               │
│              ▼                     ▼                     ▼               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │  chat.message    │  │      event       │  │   Utilities      │       │
│  │    Hook          │  │      Hook         │  │                  │       │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
│              │                     │                     │               │
│              └─────────────────────┼─────────────────────┘               │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       Utility Modules                                │   │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐     │   │
│  │  │  file-writer.ts  │ │agent-extractor.ts│ │   logger.ts     │     │   │
│  │  │                  │ │                  │ │                 │     │   │
│  │  │  - Markdown I/O  │ │ - Agent chain    │ │ - Client logging│     │   │
│  │  │  - File path     │ │   extraction     │ │ - Fallback file │     │   │
│  │  │  - Directory mgmt│ │ - Parts parsing │ │                 │     │   │
│  │  └─────────────────┘ └─────────────────┘ └─────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Output: Markdown Files                           │   │
│  │  <project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<session>.md│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module Responsibilities

| Module | Responsibility | Public API |
|--------|----------------|------------|
| `index.ts` | Main plugin entry, hook handlers, session state management | `PromptLogPlugin()` |
| `types.ts` | TypeScript interfaces for all data structures | Export interfaces |
| `file-writer.ts` | Markdown file I/O, step and summary logging | `appendStepToPromptLog()`, `appendToPromptLog()` |
| `agent-extractor.ts` | Parse message parts for agent information | `extractAgentChain()` |
| `logger.ts` | Logging abstraction with fallback | `initLogger()`, `logInfo()`, `logError()` |

---

## 2. Module Design Details

### 2.1 Main Entry Point (index.ts)

**Purpose**: Plugin factory function that initializes the plugin and returns hook handlers.

**Key Responsibilities**:
1. Initialize logger with client and directory
2. Manage session state lifecycle (create, update, cleanup)
3. Handle chat.message hook (session initialization)
4. Handle event hook (step logging, summary writing)
5. Coordinate between hooks for complete workflow

**Core Functions**:

```typescript
// Main plugin factory
PromptLogPlugin({
  client: any,
  directory: string
}): Promise<{
  'chat.message': (input: any, output: any) => Promise<void>,
  event: ({ event }: { event: any }) => Promise<void>
}>
```

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
message.updated (assistant completes)
    │
    ▼
Write step log, accumulate tokens
    │
    ▼
session.idle (session ends)
    │
    ▼
Write summary, cleanup SessionState
```

### 2.2 Type Definitions (types.ts)

**Purpose**: Define all TypeScript interfaces used throughout the plugin.

**Interfaces Defined**:
1. `MessageStep` - Single assistant message step data
2. `SessionState` - In-memory session tracking data
3. `LogData` - Summary data for writing to file

**Design Rationale**:
- Separation of in-memory vs. persisted data structures
- Accumulator fields in SessionState for step aggregation
- Read-only LogData for clean write operations

### 2.3 File Writer (file-writer.ts)

**Purpose**: Handle all Markdown file I/O operations.

**Key Functions**:

```typescript
// Write step entry (called per assistant message)
appendStepToPromptLog(
  directory: string,
  sessionID: string,
  sessionStartTime: string,
  step: MessageStep,
  isFirstStep: boolean,
  prompt: string
): Promise<void>

// Write summary entry (called once per session)
appendToPromptLog(
  directory: string,
  data: LogData,
  sessionState: SessionState
): Promise<void>
```

**File Format Design**:
```
# Prompt Log - Session

### Prompt
<user's original prompt>

### Step 1 — 10:30:15
- **Agent**: oracle
- **Model**: opencode/hy3-preview-free
- **Duration**: 12.34s
- **Input Tokens**: 150
- **Output Tokens**: 800
- **Cache Read**: 0
- **Cache Write**: 0

---

## Summary — 10:30:15
- **Model**: opencode/hy3-preview-free
- **Agent Chain**: oracle → build
- **Total Duration**: 12.34s
- **Steps**: 1
- **Total Input Tokens**: 150
- **Total Output Tokens**: 800
- **Total Cache Read**: 0
- **Total Cache Write**: 0
```

**Runtime Abstraction**:
- Detect runtime via `typeof Bun !== 'undefined'`
- Bun: Use `Bun.file()` API
- Node.js: Use `fs` module
- Both support async operations

### 2.4 Agent Extractor (agent-extractor.ts)

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

### 2.5 Logger (logger.ts)

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
                   │                    message.updated                │
                   │◀─────────────────────────────────────────────────│
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ Event Handler:  │                │                         │
          │ - Validate      │                │                         │
          │   completion    │                │                         │
          │ - Extract tokens│                │                         │
          │ - Write step    │                │                         │
          │ - Accumulate    │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   │                    session.idle                  │
                   │◀─────────────────────────────────────────────────│
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ Write Summary: │                │                         │
          │ - Calculate    │                │                         │
          │   duration     │                │                         │
          │ - Aggregate    │                │                         │
          │   tokens       │                │                         │
          │ - Write file   │                │                         │
          │ - Cleanup mem  │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ .opencode/      │                │                         │
          │ prompts/        │                │                         │
          │ opencode-prompt │                │                         │
          │ -YYYY-MM-DD_    │                │                         │
          │ <session>.md    │                │                         │
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
└────────┬──────────┘            (input, output, cache)
         │ No
         ▼
┌───────────────────┐
│ Has info.usage?   │──Yes──▶ Use legacy structure
└────────┬──────────┘            (prompt_tokens, completion_tokens)
         │ No
         ▼
┌───────────────────┐
│ Skip this event   │ (wait for next event with token data)
└───────────────────┘
```

---

## 4. API Design

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

### 4.2 Hook Input/Output Schemas

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
  type: 'message.updated' | 'session.idle' | 'session.status';
  properties: {
    info?: {
      id: string;
      sessionID: string;
      role: 'assistant';
      time?: { completed: boolean };
      tokens?: { input, output, context, cache: { read, write } };
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

---

## 6. Security Considerations

### 6.1 Data Privacy
- Logs contain user prompts - consider who has access to .opencode/prompts/ directory
- No sensitive data filtering (user responsibility to sanitize if needed)
- Local file storage only, no network transmission

### 6.2 File Access
- Plugin writes to project .opencode/prompts/ subdirectory
- No access to files outside the designated log directory
- Compatible with standard file permission models

---

## 7. Performance Optimization

### 7.1 Async File Operations
- All file I/O is asynchronous (non-blocking)
- Bun: Native async file API
- Node.js: async fs methods

### 7.2 String Concatenation
- Pre-allocate content strings where possible
- Use template literals for formatting
- Minimal string allocations in hot paths

### 7.3 Memory Efficiency
- SessionState uses Set for O(1) membership checks
- Maximum 100 sessions hard limit
- Cleanup on session end prevents memory leaks

---

## 8. Testing Strategy

### 8.1 Unit Tests
- agent-extractor.ts - Agent chain extraction logic
- file-writer.ts - Markdown formatting (mock fs)
- Individual function logic

### 8.2 Integration Tests
- Full plugin lifecycle (mock OpenCode hooks)
- File output verification
- Multiple step handling

### 8.3 Manual Testing
- Real OpenCode session capture
- Log file content verification
- Edge case exploration

---

## 9. Configuration and Extension Points

### 9.1 Build Configuration
- TypeScript compilation with strict mode
- esbuild bundling for distribution
- Output: ESM format for Bun/Node compatibility

### 9.2 Extension Points (Future)
- Custom log format templates
- Additional metadata fields
- Webhook notifications
- Export format options (JSON, CSV)