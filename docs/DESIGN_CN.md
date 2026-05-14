# OpenCode Prompt Tracker 插件 — 设计文档

## 1. 系统架构概览

### 1.1 架构模式
该插件采用模块化、事件驱动的架构，使用 OpenCode 的钩子系统。它作为被动观察者运行，捕获对话事件而不干扰 OpenCode 的核心功能。

### 1.2 系统组件

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OpenCode 核心                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PromptRecorderPlugin（入口点）                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  sessionStates (Map<string, SessionState>)                           │   │
│  │  - 内存中存储活动会话                                                │   │
│  │  - 最多 100 个会话（LRU 淘汰）                                      │   │
│  │  - 存储 prompt、model、agentChain、累加 tokens                      │   │
│  │  - messageTexts Map 用于任务描述收集                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│              ┌─────────────────────┼─────────────────────┐                │
│              │                     │                     │                │
│              ▼                     ▼                     ▼                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐        │
│  │  chat.message   │  │      event       │  │    工具模块      │        │
│  │    钩子          │  │      钩子         │  │                  │        │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘        │
│              │                     │                     │                │
│              └─────────────────────┼─────────────────────┘                │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       工具模块                                        │   │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐     │   │
│  │  │  file-writer.ts  │ │   config.ts    │ │   billing.ts   │     │   │
│  │  │                  │ │                  │ │                 │     │   │
│  │  │  - Markdown I/O  │ │  - 配置加载器   │ │  - 成本计算     │     │   │
│  │  │  - Step + Summary│ │  - 默认值      │ │  - 模型定价     │     │   │
│  │  │  - 目录管理      │ │  - JSON 解析   │ │  - 格式化输出   │     │   │
│  │  └─────────────────┘ └─────────────────┘ └─────────────────┘     │   │
│  │  ┌─────────────────┐ ┌─────────────────┐                           │   │
│  │  │agent-extractor.ts│ │   logger.ts    │                           │   │
│  │  │                  │ │                 │                           │   │
│  │  │ - Agent 链       │ │ - 客户端日志   │                           │   │
│  │  │   提取          │ │ - 备用文件     │                           │   │
│  │  │ - Parts 解析    │ │                 │                           │   │
│  │  └─────────────────┘ └─────────────────┘                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    输出：Markdown 文件                              │   │
│  │  <project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<session>.md│  │
│  │  （可通过 opencode-prompt-tracker.config.json 自定义）               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 模块职责

| 模块 | 职责 | 公共 API |
|------|------|----------|
| `index.ts` | 主插件入口，钩子处理器，会话状态管理，任务提取，思维链收集 | `PromptRecorderPlugin()` |
| `types.ts` | 所有数据结构的 TypeScript 接口 | 导出接口 |
| `file-writer.ts` | Markdown 文件 I/O，步骤/摘要日志，全量日志文件 | `appendStepToPromptRecorder()`, `appendToPromptRecorder()`, `appendAllLogsToPromptRecorder()` |
| `config.ts` | 加载配置文件与默认值 | `loadConfig()`, `getDefaultConfig()` |
| `billing.ts` | 基于模型定价计算 Token 成本 | `calculateStepCost()`, `formatCostLine()`, `findModelPricing()` |
| `agent-extractor.ts` | 解析消息部分以获取 Agent 信息 | `extractAgentChain()` |
| `logger.ts` | 带备用功能的日志抽象 | `initLogger()`, `logInfo()`, `logError()` |

---

## 2. 模块设计详解

### 2.1 主入口点（index.ts）

**目的**：插件工厂函数，初始化插件并返回钩子处理器。

**主要职责**：
1. 初始化日志器和配置加载器
2. 管理会话状态生命周期（创建、更新、清理）
3. 处理 chat.message 钩子（会话初始化）
4. 处理 event 钩子（文本收集、步骤日志、摘要写入）
5. 从累积消息文本中提取任务描述
6. 协调钩子之间的完整工作流

**核心函数**：
```typescript
// 主插件工厂
PromptRecorderPlugin({
  client: any,
  directory: string
}): Promise<{
  'chat.message': (input: any, output: any) => Promise<void>,
  event: ({ event }: { event: any }) => Promise<void>
}>
```

**关键提取函数**（在 index.ts 中）：
- `extractPromptFromParts()` - 从消息部分提取用户提示词
- `extractModelFromInput()` - 从输入上下文提取模型标识符
- `extractTokens()` - 提取 Token 计数（主要和旧格式）
- `extractAgentFromInfo()` - 使用 5 级优先级回退提取 Agent 名称
- `extractTaskDescription()` - 使用 5 级回退链提取简短任务描述

**会话状态生命周期**：
```
chat.message（用户发送消息）
    │
    ▼
使用初始数据创建 SessionState
    │
    ▼
存储在 sessionStates Map 中
    │
    ▼
message.part.updated（累积文本用于任务描述）
    │
    ▼
message.updated（助手完成）
    │
    ▼
写入步骤日志，提取任务，累加 tokens
    │
    ▼
session.idle 或 session.status (type: idle)
    │
    ▼
写入包含总计的摘要 + 可选成本
    │
    ▼
从内存中清理 SessionState
```

### 2.2 类型定义（types.ts）

**目的**：定义插件中使用的所有 TypeScript 接口。

**定义的接口**：
1. `MessageStep` - 单个助手消息步骤数据（包含 taskDescription）
2. `SessionState` - 内存中会话跟踪，包含累加字段
3. `LogData` - 写入文件的摘要数据（包含可选 costBreakdown）
4. `BillingModelConfig` - 模型定价配置
5. `BillingConfig` - 计费功能启用/禁用 + 模型列表
6. `PromptRecorderConfig` - 主插件配置
7. `CostBreakdown` - 计算的成本明细

**设计原理**：
- 内存中数据与持久化数据结构的分离
- SessionState 中的累计字段用于步骤聚合
- 只读 LogData 用于干净的写操作
- 可选 costBreakdown 用于条件性计费显示

### 2.3 文件写入器（file-writer.ts）

**目的**：处理所有 Markdown 文件 I/O 操作。

**关键函数**：
```typescript
// 写入步骤条目（每个助手消息调用一次）
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

// 写入摘要条目（每个会话调用一次）
appendToPromptRecorder(
  directory: string,
  data: LogData,
  sessionState: SessionState,
  outputPath: string,
  filePrefix: string
): Promise<void>
```

**文件格式设计**：
```markdown
# Prompt-Tracker

## Prompt
<用户原始提示词>

### Step 1 — 10:30:15
- **Agent**: oracle
- **Model**: opencode/hy3-preview-free
- **Duration**: 12.34s
- **Total Tokens**: 950 (input: 150, output: 800)
- **Cached Tokens**: 100 (read: 0, write: 100)
- **Uncached Tokens**: 50
- **Task**: 分析认证模块结构

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

**运行时抽象**：
- 通过 `typeof Bun !== 'undefined'` 检测运行时
- Bun: 使用 `Bun.file()` API
- Node.js: 使用 `fs` 模块
- 两者都支持异步操作

### 2.4 配置加载器（config.ts）

**目的**：加载配置并与默认值合并。

**配置文件**：`opencode-prompt-tracker.config.json`（项目根目录）

**默认配置**：
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

**关键函数**：
```typescript
loadConfig(directory: string): Promise<PromptRecorderConfig>
getDefaultConfig(): PromptRecorderConfig
```

**设计原理**：
- 如果配置文件缺失或无效则优雅地回退到默认值
- 支持自定义输出目录和文件命名
- 计费功能是可选的（默认禁用）

### 2.5 计费计算器（billing.ts）

**目的**：根据配置的模型定价计算 Token 成本。

**定价结构**（每百万 Token 的价格）：
```typescript
interface BillingModelConfig {
  model: string;       // 完整模型名称（例如 'opencode/sonnet-4'）
  input: number;       // 每百万输入 Token（未缓存）的价格
  output: number;      // 每百万输出 Token 的价格
  cacheRead: number;   // 每百万缓存读取 Token 的价格
  cacheWrite: number;  // 每百万缓存写入 Token 的价格
}
```

**成本计算公式**：
```
inputCost = (inputTokens - cacheRead - cacheWrite) / 1M * pricing.input
outputCost = outputTokens / 1M * pricing.output
cacheCost = (cacheRead / 1M * pricing.cacheRead) + (cacheWrite / 1M * pricing.cacheWrite)
totalCost = inputCost + outputCost + cacheCost
```

**关键函数**：
```typescript
calculateStepCost(model, inputTokens, outputTokens, cacheRead, cacheWrite, pricing): CostBreakdown | null
formatCostLine(cost: CostBreakdown): string
findModelPricing(model: string, models: BillingModelConfig[]): BillingModelConfig | null
```

### 2.6 Agent 提取器（agent-extractor.ts）

**目的**：从 OpenCode 消息部分提取 Agent 名称。

**提取逻辑**：
```typescript
extractAgentChain(parts: any[]): string[]
```

**算法**：
1. 遍历数组中的所有部分
2. 匹配 `part.type === 'agent'` → 提取 `part.name`
3. 匹配 `part.type === 'subtask'` → 提取 `part.agent`
4. 按出现顺序返回 Agent 名称数组

**设计原理**：
- 单一职责的简单专注函数
- 无外部依赖
- 返回数组便于与其他来源合并

### 2.7 日志器（logger.ts）

**目的**：提供双输出路径的日志抽象。

**设计模式**：带备用的装饰器模式

```
主要：client.app.log() → OpenCode 控制台
    │
    │（失败时）
    ▼
备用：写入 .opencode/prompts/.plugin-log
```

**关键函数**：
```typescript
initLogger(client: any, directory: string): void
logInfo(message: string, extra?: any): Promise<void>
logError(message: string, extra?: any): Promise<void>
```

**错误处理**：静默失败 - 日志错误不应破坏插件功能。

### 2.8 全量日志功能（file-writer.ts + index.ts）

**目的**：捕获包含思维链/推理内容的完整对话日志。

**关键函数**：
```typescript
// 在 file-writer.ts 中
formatAllLogsEntry(data: AllLogsData): string
appendAllLogsToPromptRecorder(directory, sessionID, sessionStartTime, data, outputPath): Promise<void>

// 在 index.ts 中 - SessionState 扩展
allUserInputs: string[]           // 收集的用户输入
allUserInputTimes: string[]        // 用户输入时间戳
allAssistantOutputs: string[]      // 收集的助手输出（包含思维内容）
allAssistantOutputTimes: string[] // 助手输出时间戳
allLogsFilePath: string | null      // 全量日志文件路径
```

**输出格式**：
```markdown
# All Logs

## Session: <sessionID>
**Start:** <time> | **End:** <time>

---

### User Input #1 — 10:30:15
```
[用户消息]
```

---

### Assistant Output #1 — 10:30:16
```
[思维内容]
[助手响应]
```

---
```

**流程**：
1. `chat.message` → 收集用户输入 + 时间戳
2. `message.part.updated` (thinking) → 收集到思维缓冲区
3. `message.part.updated` (text) → 收集到响应缓冲区
4. `message.updated` → 合并思维 + 响应，存储到会话
5. `session.idle` → 写入全量日志文件（如果 `saveAllLogs: true`）

### 2.9 思维链/推理内容收集（index.ts）

**目的**：从思维链/推理内容中提取任务描述。

**关键函数**：
```typescript
extractTaskDescription(text, info, thinkingText): string
extractMeaningfulLineFromThinking(thinkingText): string
```

**算法**：
1. 尝试从累积文本的第一行非空内容
2. 尝试从思维内容中提取有意义的行（通常在末尾有总结）
3. 尝试 info 元数据字段
4. 尝试 AI 响应内容结构
5. 最终回退：使用助手回复的第一段

---

## 3. 数据流程设计

### 3.1 完整数据流程

```
┌──────────────┐     chat.message     ┌──────────────┐
│   用户       │ ─────────────────────▶│   插件       │
│   发送       │                      │   接收       │
│   消息       │                      │   input+     │
└──────────────┘                      │   output     │
                                       └──────┬───────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ 提取：          │                │                         │
          │ - prompt        │                │                         │
          │ - model         │                │                         │
          │ - agentChain    │                │                         │
          │ - startTime     │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ 创建             │                │                         │
          │ SessionState    │                │                         │
          │ 在内存中         │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   │                    message.part.updated           │
                   │◀──────────────────────────────────────────────────│
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ 累积            │                │                         │
          │ 文本内容        │                │                         │
          │ 每步骤          │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   │                    message.updated                │
                   │◀─────────────────────────────────────────────────│
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ 事件处理器：     │                │                         │
          │ - 验证          │                │                         │
          │   完成状态      │                │                         │
          │ - 提取 tokens  │                │                         │
          │ - 提取任务      │                │                         │
          │ - 写入步骤      │                │                         │
          │ - 累加          │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   │                    session.idle 或                │
                   │                    session.status (idle)         │
                   │◀─────────────────────────────────────────────────│
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ 写入摘要：      │                │                         │
          │ - 计算          │                │                         │
          │   耗时          │                │                         │
          │ - 聚合          │                │                         │
          │   tokens        │                │                         │
          │ - 计算          │                │                         │
          │   成本（如启用）│                │                         │
          │ - 写入文件      │                │                         │
          │ - 清理内存     │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ .opencode/      │                │                         │
          │ prompts/        │                │                         │
          │ (或自定义路径)  │                │                         │
          └─────────────────┘                │                         │
                                              │                         │
                                              ▼
                                    ┌─────────────────┐
                                    │   用户查看      │
                                    │   日志文件      │
                                    └─────────────────┘
```

### 3.7 Token 提取流程

```
助手消息信息
        │
        ▼
┌───────────────────┐
│ 有 info.tokens?   │──是──▶ 使用主要结构
└────────┬──────────┘            (input, output, cache, reasoning)
         │ 否
         ▼
┌───────────────────┐
│ 有 info.usage?    │──是──▶ 使用旧结构
└────────┬──────────┘            (prompt_tokens, completion_tokens, cache_*)
         │ 否
         ▼
┌───────────────────┐
│ 跳过此事件        │（等待下一个带有 token 数据的事件）
└───────────────────┘
```

### 3.4 全量日志流程

```
chat.message（用户发送消息）
         │
         ▼
收集用户输入 + 时间戳
         │
message.part.updated（thinking/reasoning 思维链）
         │
         ▼
在单独缓冲区累积思维内容
         │
message.part.updated（text 响应）
         │
         ▼
将思维 + 文本合并为完整助手输出
         │
         ▼
存储合并输出 + 时间戳到会话
         │
session.idle（会话结束）
         │
         ▼
写入全量日志文件（如果 saveAllLogs 启用）
         │
         ▼
.opencode/prompts/opencode-prompt-log-YYYY-MM-DD_<sessionID>.md
```

### 3.5 思维链内容流程

```
message.part.updated（type: 'thinking' 或 'reasoning'）
         │
         ▼
键：step-thinking-<n>
         │
         ▼
在 messageTexts Map 中累积思维文本
         │
message.updated（步骤完成）
         │
         ▼
extractTaskDescription(combinedText, info, thinkingText)
         │
         ▼
尝试从思维内容中有意义的行（通常是最后几行）
         │
         ▼
如果找到：用作任务描述
如果未找到：回退到其他提取方法
```

### 3.6 任务描述提取流程

```
message.part.updated（文本累积）
        │
        ▼
┌───────────────────┐
│ 将文本追加到      │
│ messageTexts Map  │
│ 键：step-${n}    │
└────────┬──────────┘
         │
message.updated（步骤完成）
         │
         ▼
┌───────────────────┐
│ 从累积的          │
│ 文本 + info       │
│ 提取任务描述      │
│ （5 级回退）      │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ 写入包含          │
│ 任务描述的步骤    │
└───────────────────┘
```

---

## 4. API 设计

### 4.1 插件工厂 API

```typescript
// 输入参数
interface PluginConfig {
  client: any;         // OpenCode 客户端实例
  directory: string;   // 项目目录路径
}

// 输出：钩子处理器
interface PluginHooks {
  'chat.message': (input: any, output: any) => Promise<void>;
  event: ({ event }: { event: any }) => Promise<void>;
}
```

### 4.2 配置文件 API

**配置文件**：`opencode-prompt-tracker.config.json`

```json
{
  "outputPath": ".opencode/prompts",
  "filePrefix": "opencode-prompt-",
  "saveAllLogs": false,
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

### 4.3 钩子输入/输出模式

#### chat.message 钩子

**输入 (input)**:
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

**输入 (output)**:
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

#### event 钩子

**输入 (event)**:
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

## 5. 边界情况处理设计

### 5.1 竞态条件防止

**问题**：在快速的 Agent 工作流中，多个 message.updated 事件可能快速触发。

**解决方案**：使用 `completedMessageIDs` Set 跟踪已处理的消息。
```typescript
if (state.completedMessageIDs.has(messageID)) {
  return; // 跳过已处理的
}
state.completedMessageIDs.add(messageID);
```

### 5.2 不完整数据处理

**问题**：完成标志可能在 token 数据可用之前被设置。

**解决方案**：双重验证 - 同时检查完成标志和 token 可用性。
```typescript
const isComplete = info.time?.completed;
const hasFullTokens = primaryTokens && primaryTokens.input > 0 && ...;
const hasUsageTokens = info.usage && ...;

if (!isComplete || (!hasFullTokens && !hasUsageTokens)) {
  return; // 等待下一个事件
}
```

### 5.3 内存压力处理

**问题**：具有多个步骤的长时间运行会话可能消耗过多内存。

**解决方案**：100 个会话后采用 LRU 风格淘汰。
```typescript
if (sessionStates.size > 100) {
  const firstKey = sessionStates.keys().next().value;
  if (firstKey) sessionStates.delete(firstKey);
}
```

### 5.4 文件系统错误

**问题**：磁盘满、权限拒绝或并发写入冲突。

**解决方案**：带错误日志的 try-catch，不重新抛出以防止插件崩溃。
```typescript
try {
  // 文件操作
} catch (error) {
  await logError('写入失败', { error: String(error) });
  // 静默返回 - 插件继续运行
}
```

### 5.5 任务描述提取

**问题**：助手响应可能不包含预期格式的清晰任务描述。

**解决方案**：5 级回退链：
1. 累积文本的第一行有意义的文本
2. info 元数据中的 task/description 字段
3. info 中的 content 结构字段
4. AI 响应 content 的第一行
5. 助手回复内容的第一段

### 5.6 Agent 名称提取

**问题**：不同事件类型使用不同字段来表示 agent 名称。

**解决方案**：5 级优先级回退：
1. `info.agent`（直接字符串）
2. `info.agent.name`（带 name 的对象）
3. `info.name`（某些事件）
4. `info.agentInfo.name`
5. `info.providerID`（过滤后）
6. Parts 数组（agent/subtask 类型）

---

## 6. 配置设计

### 6.1 配置文件

**位置**：`<project>/opencode-prompt-tracker.config.json`

**模式**：
```typescript
interface PromptRecorderConfig {
  outputPath: string;      // 相对于项目根目录的路径
  filePrefix: string;      // 文件名前缀
  saveAllLogs: boolean;     // 启用完整对话日志记录
  billing: BillingConfig;  // 计费功能配置
}
```

### 6.2 默认值

| 字段 | 默认值 | 描述 |
|-----|--------|------|
| `outputPath` | `.opencode/prompts` | 相对于项目根的输出目录 |
| `filePrefix` | `opencode-prompt-` | 文件名前缀 |
| `saveAllLogs` | `false` | 启用完整对话捕获 |
| `billing.enabled` | `false` | 启用成本计算 |
| `billing.models` | `[]` | 模型定价配置 |

### 6.3 计费配置

**目的**：根据模型定价（每百万 Token 的价格）计算 Token 成本。

**启用时**：
- 摘要日志包含成本行
- 仅在模型匹配配置的模型时应用
- 如果未找到模型则优雅回退

---

## 7. 安全性考虑

### 7.1 数据隐私
- 日志包含用户提示词 - 考虑谁可以访问 .opencode/prompts/ 目录
- 无敏感数据过滤（如需要，用户负责清理）
- 仅本地文件存储，无网络传输

### 7.2 文件访问
- 插件写入项目 .opencode/prompts/ 子目录（或自定义路径）
- 无法访问指定日志目录之外的文件
- 与标准文件权限模型兼容

### 7.3 配置文件安全
- 配置文件位置是项目范围的（每个项目有自己的配置）
- 配置中不应存储敏感信息（模型定价是公开的）

---

## 8. 性能优化

### 8.1 异步文件操作
- 所有文件 I/O 都是异步的（非阻塞）
- Bun: 原生异步文件 API
- Node.js: 异步 fs 方法

### 8.2 字符串连接
- 在可能的情况下预分配内容字符串
- 使用模板字面量进行格式化
- 热路径中最少化字符串分配

### 8.3 内存效率
- SessionState 使用 Set 进行 O(1) 成员检查
- messageTexts Map 使用步骤号作为键进行文本累积
- 最多 100 个会话的硬限制
- 会话结束时的清理防止内存泄漏

### 8.4 配置缓存
- 插件初始化时加载一次配置
- 存储在内存中供整个插件生命周期使用
- 无重复文件读取

---

## 9. 测试策略

### 9.1 单元测试
- agent-extractor.ts - Agent 链提取逻辑
- file-writer.ts - Markdown 格式化（模拟 fs）
- billing.ts - 成本计算准确性
- config.ts - 默认值合并和文件加载

### 9.2 集成测试
- 完整插件生命周期（模拟 OpenCode 钩子）
- 文件输出验证
- 多步骤处理
- 配置文件加载

### 9.3 手动测试
- 真实 OpenCode 会话捕获
- 日志文件内容验证
- 边界情况探索
- 计费计算验证

---

## 10. 配置和扩展点

### 10.1 构建配置
- 使用严格模式的 TypeScript 编译
- esbuild 打包用于分发
- 输出：ESM 格式，兼容 Bun/Node

### 10.2 扩展点（未来）
- 自定义日志格式模板
- 额外的元数据字段
- Webhook 通知
- 导出格式选项（JSON、CSV）
- 数据库存储后端