# OpenCode Prompt Recorder Plugin — 需求文档

## 1. 项目概述

### 1.1 项目名称
OpenCode Prompt Recorder Plugin（OpenCode 对话日志插件）

### 1.2 项目类型
OpenCode 插件（TypeScript/JavaScript）

### 1.3 核心功能概述
一个自动记录每次对话的提示词、模型、Agent 调用链、耗时和 Token 使用情况的 OpenCode 插件。该插件捕获用户与助手交互的完整生命周期，提供 AI 使用模式、Token 消耗和 Agent 工作流执行的可视性。

### 1.4 目标用户
- 希望跟踪 AI 使用情况和对话历史的 OpenCode 用户
- 需要分析对话模式并优化提示词的开发者
- 监控 Token 消耗、成本和 Agent 性能的团队
- 研究 AI 助手行为和工作流效率的研究人员

---

## 2. 功能需求

### 2.1 核心功能

#### F1: 自动对话日志记录
**描述**：在对话结束后自动将每次用户与助手的交互记录到 Markdown 文件中。

**触发条件**：
- 用户发送消息（通过 `chat.message` 钩子捕获）
- 助手消息完成并包含 Token 统计信息（通过 `message.updated` 事件捕获）
- 会话空闲（通过 `session.idle` 或 `session.status (type=idle)` 事件捕获）

**输出位置**：写入 `<project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md`

**捕获的数据**：
- 用户提示词文本
- AI 模型标识符
- Agent 调用链
- 处理耗时（总计 + 每步）
- Token 使用情况（输入、输出、上下文、缓存读写）
- 任务描述（从助手输出中提取）
- 成本计算（当配置了计费时）
- 结束时间（会话完成时）

#### F2: Agent 链追踪
**描述**：记录完整的 Agent 调用链（例如：`oracle → build → explore`）。

**范围**：包括首次调用的 Agent 和通过其他 Agent 调用的子 Agent。

**数据来源**：
- 来自 chat.message 钩子的 `input.agent`
- 来自 `output.parts` 数组的 agent 和 subtask 类型

**提取逻辑**：
- 直接 Agent 调用：`{ type: 'agent', name: 'agentName' }`
- 通过 Agent 的子任务：`{ type: 'subtask', agent: 'agentName' }`

**合并逻辑**：初始 Agent 与提取的 Agent 链合并，去重后保留顺序

**输出格式**：箭头分隔的字符串（例如：'oracle → build → explore'）

#### F3: Token 统计
**描述**：为每次对话记录详细的 Token 使用信息。

**字段说明**：
| 字段 | 描述 |
|------|------|
| 输入 Token | 对话消耗的总输入 Token 数量（包含缓存部分） |
| 输出 Token | 助手生成的总输出 Token 数量 |
| 缓存读取 | 从缓存中读取的 Token（按折扣计费） |
| 缓存写入 | 写入缓存的 Token（按溢价计费） |
| 未缓存 Token | 输入 Token - 缓存读取 - 缓存写入 |
| 缓存 Token | 缓存读取 + 缓存写入（输入 Token 的子集） |

**数据来源**：
- 主要来源：`info.tokens` 结构（input、output、context、cache.read、cache.write）
- 备用来源：`info.usage` 结构（prompt_tokens、completion_tokens、cache_read_input_tokens、cache_creation_input_tokens）

**提取逻辑**：
- 从 `info.tokens.input` 和 `info.tokens.output` 提取
- 备用至 `info.usage.prompt_tokens/completion_tokens` 或 `info.usage.input_tokens/output_tokens`
- 处理新旧两种数据结构

#### F4: 耗时追踪
**描述**：记录每次对话从开始到完成的处理耗时。

**两种耗时类型**：
1. **总耗时**：结束时间 - 开始时间（整个会话）
2. **每步耗时**：连续步骤完成之间的时间间隔

**计算方式**：单位：秒，保留 2 位小数

**开始时间捕获**：
- 用户发送消息时捕获
- 来源：`chat.message` 钩子触发时的时间戳

**结束时间捕获**：
- 会话空闲时捕获
- 来源：`session.idle` 或 `session.status (type=idle)` 事件触发时的时间戳

**每步耗时计算**：
- 在 SessionState 中追踪 `lastStepEndTime`
- 步骤耗时 = 当前步骤结束时间 - lastStepEndTime
- 每个步骤记录后更新 `lastStepEndTime`

**输出格式**：保留 2 位小数的字符串（例如："12.34"）

#### F5: 每日文件归档
**描述**：按日期自动生成日志文件，便于检索和分析。

**文件命名规范**：`opencode-prompt-YYYY-MM-DD_<sessionID>.md`

**会话处理**：
- 每个会话对应一个文件
- 同一会话的多次交互追加到同一文件
- 文件存储在 `<project>/.opencode/prompts/` 目录

**目录创建**：如果 `.opencode/prompts/` 目录不存在则自动创建

#### F6: 实时步骤日志
**描述**：在 Agent 工作流（例如：Sisyphus Ultraworker）中，多个助手消息可能在一个会话内完成。每个完成的助手消息都会立即记录为一个"步骤"。

**行为**：
- 每个步骤在完成时立即记录
- 提供 Agent 工作流的实时可见性
- 会话空闲时写入累计总数的摘要

**捕获的步骤信息**：
- 步骤编号
- 消息 ID
- Agent 名称
- 使用的模型
- 完成时间（开始 → 结束时间范围）
- 耗时（每步耗时，而非总耗时）
- 任务描述
- Token 计数（该步骤的输入/输出/缓存）

#### F7: 任务描述提取
**描述**：从助手输出中自动提取简短的任务描述。

**提取优先级**：
1. 从累积的文本内容中获取第一行有意义的内容
2. 从 info 元数据字段中尝试（task、description、name 等）
3. 从 AI 响应内容结构中提取
4. 从助手的回复内容中获取第一段
5. 跳过通用模型名称和格式前缀

**文本清理**：
- 移除尾部标点符号（`;:,.!?`）
- 最大长度限制：120 字符
- 跳过通用模式：`unknown`、`opencode/`、`claude-`、`gpt-`、代码块标记等

**数据来源**：
- 通过 `message.part.updated` 事件累积文本内容
- 按消息 ID 存储在 `messageTexts` Map 中

#### F8: 计费系统
**描述**：当配置了模型价格时，计算并记录每次对话的成本。

**配置项**：
```json
{
  "billing": {
    "enabled": true,
    "models": [
      {
        "model": "opencode/sonnet-4",
        "input": 3.75,      // 每百万 Token 的输入价格
        "output": 15.0,     // 每百万 Token 的输出价格
        "cacheRead": 0.3,  // 每百万 Token 的缓存读取价格
        "cacheWrite": 3.75 // 每百万 Token 的缓存写入价格
      }
    ]
  }
}
```

**成本计算**：
- 未缓存输入成本 = (未缓存输入 Token / 1,000,000) × input 价格
- 输出成本 = (输出 Token / 1,000,000) × output 价格
- 缓存成本 = 缓存读取成本 + 缓存写入成本
- 总成本 = 输入成本 + 输出成本 + 缓存成本

**输出格式**：
```markdown
- **Cost**: $0.0123 (input: $0.005, output: $0.007, cache: $0.0003)
```

#### F9: 保存完整对话日志
**描述**：可选地将完整的对话日志（包括所有用户输入和助手输出）保存到单独的文件中。

**触发条件**：当配置中 `saveAllLogs: true`

**输出文件**：`<project>/.opencode/prompts/opencode-prompt-log-YYYY-MM-DD_<sessionID>.md`

**捕获的数据**：
- 所有用户输入（不仅仅是第一个提示词）
- 所有助手输出（完整内容，不仅仅是步骤元数据）
- 每个用户输入和助手输出的时间戳
- 会话开始和结束时间

**文件格式**：
```markdown
# All Logs

## Session: ses_abc123
**Start:** 10:30:15 | **End:** 10:35:30

---

### User Input #1 — 10:30:15
[完整用户提示词]

---

### Assistant Output #1 — 10:30:20
[完整助手回复]

---

### User Input #2 — 10:31:00
[第二个用户提示词]

---

### Assistant Output #2 — 10:31:30
[第二个助手回复]

---
```

**实现说明**：
- 用户输入在 `chat.message` 钩子期间收集
- 助手输出在 `message.part.updated` 事件期间收集
- 文件在 session.idle 触发时写入一次
- 不需要 Token 可用性检查（在流式传输时捕获文本）

---

### 2.2 用户交互和钩子

#### 钩子：chat.message
**目的**：捕获用户发送的消息，记录初始会话状态。

**执行的操作**：
1. 检查是否存在已完成消息的会话，先写入摘要再重新开始
2. 从 `output.parts` 提取提示词文本（筛选文本类型部分）
3. 从 `input.model` 提取模型信息（支持对象和字符串格式）
4. 从 `input.agent` 构建初始 Agent 链
5. 使用 agent-extractor 从 `output.parts` 提取额外的 Agent
6. 存储会话状态在内存中（sessionStates Map）
7. 内存管理：保留最近的 100 个会话

**存储在 SessionState 中的数据**：
- userMsgID、prompt、model、startTime、agentChain、sessionStartTime
- 累计字段：totalInputTokens、totalOutputTokens、totalContextTokens、totalCacheRead、totalCacheWrite
- 跟踪字段：completedMessageIDs、stepCount、headerWritten、hasCompletedMessage
- 文本收集字段：messageTexts（按步骤编号存储累积的文本）

#### 钩子：event
**目的**：监控助手消息完成、会话空闲和状态转换。

**处理的事件类型**：
| 事件类型 | 操作 |
|----------|------|
| message.part.updated | 按消息 ID 累积文本内容，用于任务描述提取 |
| message.updated | 处理已完成的助手消息，写入步骤日志，累加 Token |
| session.idle | 写入累计总数的摘要日志，清理会话状态 |
| session.status (type=idle) | 摘要日志的备用触发器 |

**message.part.updated 处理**：
- 筛选 text 类型部分
- 按 `step-${stepCount + 1}` 键存储累积文本

**message.updated 处理逻辑**：
1. 验证消息角色为 'assistant'
2. 验证完成状态：`info.time?.completed` 标志
3. 验证 Token 可用性：检查 `info.tokens` 或 `info.usage` 结构
4. 跳过已处理的消息（使用 completedMessageIDs Set）
5. 提取 Token、Agent、模型信息
6. 从累积文本中提取任务描述
7. 立即写入步骤日志
8. 将会话 Token 累加到总数
9. 更新 lastModel

**完成检查逻辑**：
- 检查 `info.time?.completed` 标志
- 检查主要 Token 结构：`info.tokens.input > 0 && info.tokens.output > 0 && info.tokens.reasoning !== undefined`
- 或检查备用 Token 结构：`info.usage.prompt_tokens > 0 && info.usage.completion_tokens > 0`
- 在写入日志前等待两个条件都满足（防止数据不完整）

---

### 2.3 数据结构

#### SessionState（内存中）
```typescript
interface SessionState {
  userMsgID: string;           // 用户消息的唯一标识符
  prompt: string;              // 用户的提示词文本
  model: string;               // AI 模型标识符（初始值）
  startTime: number;           // 会话开始时的 Unix 时间戳（毫秒）
  agentChain: string[];        // Agent 调用链数组
  sessionStartTime: string;     // 日期字符串（YYYY-MM-DD）
  completedMessageIDs: Set<string>;  // 已处理的消息 ID，用于避免重复计数
  totalInputTokens: number;     // 累计输入 Token
  totalOutputTokens: number;   // 累计输出 Token
  totalContextTokens: number;  // 累计上下文 Token
  totalCacheRead: number;      // 累计缓存读取 Token
  totalCacheWrite: number;     // 累计缓存写入 Token
  lastModel: string;           // 最近消息的模型（可能与初始模型不同）
  hasCompletedMessage: boolean; // 是否有至少一条消息完成
  stepCount: number;           // 已完成步骤数
  headerWritten: boolean;      // 是否已写入文件头
  messageTexts: Map<string, string>; // 按消息 ID 累积的文本内容
  lastStepEndTime: number;     // 上一个步骤结束时的 Unix 时间戳（毫秒），用于计算每步耗时
  allUserInputs: string[];     // 为 all-logs 功能收集的用户输入
  allUserInputTimes: string[]; // 用户输入的时间戳
  allAssistantOutputs: string[]; // 为 all-logs 功能收集的助手输出
  allAssistantOutputTimes: string[]; // 助手输出的时间戳
  allLogsFilePath: string | null; // all-logs 日志文件路径（在会话空闲时设置）
}
```

#### MessageStep（每个步骤）
```typescript
interface MessageStep {
  stepNumber: number;          // 步骤编号（从 1 开始）
  messageID: string;           // 唯一消息标识符
  agent: string;               // 此步骤的 Agent 名称
  model: string;               // 此步骤使用的模型
  time: string;                // 格式化时间（HH:MM:SS）
  duration: string;            // 耗时（秒）
  taskDescription: string;     // 从输出中提取的任务描述（最多 120 字符）
  inputTokens: number;         // 此步骤的输入 Token（包含缓存部分）
  outputTokens: number;        // 此步骤的输出 Token
  cachedTokens: number;        // 此步骤的缓存 Token（read + write）
  uncachedTokens: number;      // 此步骤的未缓存 Token（input - cache）
  cacheRead: number;           // 此步骤的缓存读取 Token
  cacheWrite: number;          // 此步骤的缓存写入 Token
  totalTokens: number;         // 此步骤的总 Token（input + output）
}
```

#### LogData（用于摘要写入）
```typescript
interface LogData {
  sessionID: string;           // 会话标识符
  time: string;                // 格式化时间（HH:MM:SS）
  endTime: string;             // 会话结束时的格式化时间（HH:MM:SS）
  agentChain: string;          // Agent 链（箭头分隔）
  model: string;               // AI 模型标识符
  prompt: string;              // 用户原始提示词
  duration: string;            // 耗时（秒）
  steps: number;               // 已完成步骤数
  totalTokens: number;         // 总 Token（input + output）
  inputTokens: number;         // 总输入 Token（包含缓存部分）
  outputTokens: number;         // 总输出 Token
  cachedTokens: number;        // 总缓存 Token（read + write）
  uncachedTokens: number;      // 总未缓存 Token
  cacheRead: number;           // 总缓存读取 Token
  cacheWrite: number;         // 总缓存写入 Token
  costBreakdown?: CostBreakdown; // 成本明细（当计费启用且模型匹配时）
}

interface CostBreakdown {
  inputCost: number;    // 未缓存输入成本
  outputCost: number;   // 输出成本
  cacheCost: number;    // 缓存成本（read + write）
  totalCost: number;    // 总成本
}

interface BillingModelConfig {
  model: string;        // 模型名称（需与 LogData.model 匹配）
  input: number;       // 每百万 Token 输入价格
  output: number;       // 每百万 Token 输出价格
  cacheRead: number;   // 每百万 Token 缓存读取价格
  cacheWrite: number;  // 每百万 Token 缓存写入价格
}

/**
 * All-logs 文件的数据结构（完整对话捕获）
 */
interface AllLogsData {
  sessionID: string;           // 会话标识符
  startTime: string;           // 会话开始时的格式化时间（HH:MM:SS）
  endTime: string;             // 会话结束时的格式化时间（HH:MM:SS）
  userInputs: string[];        // 收集的用户输入
  userInputTimes: string[];    // 用户输入的时间戳
  assistantOutputs: string[];  // 收集的助手输出（完整内容）
  assistantOutputTimes: string[]; // 助手输出的时间戳
}
```

---

### 2.4 边界情况处理

| 边界情况 | 处理方式 |
|----------|----------|
| 长响应 | 插件等待 Token 统计可用后再写入（不仅仅是完成标志） |
| 内存管理 | 内存中最多存储 100 个会话，超过时删除最旧的 |
| 无会话状态 | 如果找不到会话状态则跳过日志记录（可能已被清理） |
| 缺失 Token | 如果 Token 数据不可用则跳过日志记录并等待下一个事件 |
| 文件创建 | 如果不存在则自动创建 `.opencode/prompts/` 目录 |
| 模型格式 | 同时支持对象格式（providerID/modelID）和字符串格式 |
| 运行时兼容性 | 同时支持 Bun 和 Node.js 运行时 |
| 重复步骤 | 使用 completedMessageIDs Set 避免重复计数 |
| 部分数据 | 同时等待完成标志和 Token 可用性 |
| 会话中断 | 如果会话已有完成消息，新消息触发前先写入摘要 |
| 任务描述缺失 | 使用多种备用策略提取，仍无内容时留空 |
| 通用模型名 | 过滤 `opencode/`、`claude-`、`gpt-` 等作为任务描述 |
| 计费模型未配置 | 当模型价格未配置时不计算成本，摘要中无 Cost 行 |
| All-Logs 禁用 | 当 `saveAllLogs: false` 时，仅记录步骤元数据（不保存完整内容） |
| All-Logs 空内容 | 仅保存.trim()后非空的内容条目 |

---

## 3. 非功能需求

### 3.1 性能
- 对 OpenCode 响应时间的影响最小化
- 异步文件写入（非阻塞）
- 高效的内存使用（最多 100 个会话）
- 从消息信息中快速提取 Token
- 支持 Bun 运行时优化（利用 Bun.file 和 Bun.write）

### 3.2 可靠性
- 文件写入失败的错误处理
- 当 OpenCode 客户端日志不可用时回退到文件日志
- 成功日志记录后会话状态清理（防止内存泄漏）
- 数据不完整时的优雅降级
- 日志功能失败静默处理（不影响插件主功能）

### 3.3 兼容性
- OpenCode 插件 API（主要）
- Bun 运行时（主要，已优化）
- Node.js 运行时（备用）
- TypeScript 严格模式

### 3.4 可维护性
- 清晰的模块分离（index、types、utils）
- 全面的 JSDoc 注释
- 所有数据结构的类型安全接口
- 核心工具的单元测试（Bun test）
- 代码格式化（Prettier）

---

## 4. 用户故事

| 编号 | 用户故事 | 验收标准 |
|------|----------|----------|
| US1 | 作为一个开发者，我希望自动记录我的 OpenCode 对话，以便稍后查看我的 AI 使用历史 | 每次对话都在 .opencode/prompts/ 中创建 Markdown 文件 |
| US2 | 作为一个团队负责人，我希望看到对话中使用了哪些 Agent，以便了解工作流模式 | Agent 链被捕获并显示在日志文件中 |
| US3 | 作为一个注重成本的用户，我希望跟踪每次对话的 Token 使用情况，以便监控我的 AI 支出 | Token 计数（输入、输出、缓存）被准确记录 |
| US4 | 作为一个性能分析师，我希望看到每次对话需要多长时间，以便识别瓶颈 | 耗时被计算并以秒为单位记录 |
| US5 | 作为一个研究人员，我希望有每日日志文件，以便按日期组织和分析数据 | 文件使用日期前缀（YYYY-MM-DD）命名 |
| US6 | 作为一个 Agent 工作流用户，我希望看到每个步骤的详细信息，以便了解多步骤过程 | 每个助手消息被记录为单独的步骤 |
| US7 | 作为一个需要计费的用户，我希望系统自动计算成本，以便了解每次对话的花费 | 当配置模型价格后，摘要中显示成本明细 |
| US8 | 作为一个希望了解任务内容的用户，我希望看到每个步骤的任务描述，以便快速了解对话内容 | 从助手输出中自动提取第一行内容作为任务描述 |
| US9 | 作为一个希望获取完整历史的用户，我希望保存完整的对话日志，以便稍后回顾所有交流内容 | 当配置 `saveAllLogs: true` 时，所有用户输入和助手输出都被保存到单独的文件中 |

---

## 5. 数据流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           用户发送消息                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       chat.message 钩子触发                                │
│  - 检查是否有已完成消息的会话，先写入摘要                                  │
│  - 从 output.parts 提取提示词                                               │
│  - 从 input.model 提取模型                                                 │
│  - 从 input.agent + output.parts 提取 Agent 链                            │
│  - 初始化 messageTexts Map                                                │
│  - 在内存中存储 SessionState                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      助手生成响应 + 流式输出                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   message.part.updated 事件触发                            │
│  - 筛选 text 类型部分                                                       │
│  - 按 step-${stepCount+1} 键累积文本到 messageTexts Map                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    message.updated 事件触发（助手完成）                    │
│  - 验证角色为 'assistant'                                                   │
│  - 验证完成状态（info.time.completed）                                     │
│  - 验证 Token 可用性（info.tokens 或 info.usage）                         │
│  - 跳过已处理的消息                                                        │
│  - 提取 Token、Agent、模型信息                                              │
│  - 从 messageTexts 获取累积文本，提取任务描述                              │
│  - 立即写入步骤日志                                                        │
│  - 累加 Token 到会话总数                                                   │
│  - 更新 lastModel                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       会话进入空闲状态                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              session.idle 或 session.status (type=idle) 触发               │
│  - 计算总耗时                                                              │
│  - 查找模型定价（如启用计费）                                              │
│  - 计算成本明细                                                            │
│  - 构建摘要 LogData                                                        │
│  - 写入摘要到 Markdown 文件                                               │
│  - 从内存中清理 SessionState                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. 验收标准

### AC1: 基础日志记录
- [ ] 每次对话都被记录到 Markdown 文件
- [ ] 文件创建在 `.opencode/prompts/` 目录
- [ ] 文件命名遵循模式 `opencode-prompt-YYYY-MM-DD_<sessionID>.md`
- [ ] Markdown 文件包含步骤记录和摘要部分

### AC2: 数据完整性
- [ ] 所有字段都被记录：时间、模型、Agent 链、提示词、耗时、Token（输入/输出/缓存）
- [ ] Token 计数与消息信息中的实际使用量匹配
- [ ] 耗时被准确计算（结束时间 - 开始时间）
- [ ] 任务描述被正确提取（最多 120 字符）

### AC3: Agent 链
- [ ] 捕获输入上下文中的主 Agent
- [ ] 捕获消息部分中的子 Agent
- [ ] Agent 链合并去重并格式化
- [ ] Agent 链格式化为箭头分隔的字符串

### AC4: 多步骤处理
- [ ] 每个助手消息被记录为单独的步骤
- [ ] 步骤按顺序编号
- [ ] Token 在步骤间累计
- [ ] 会话空闲后写入摘要
- [ ] 同一会话的新消息触发前先写入前一会话摘要

### AC5: 消息文本收集
- [ ] 通过 message.part.updated 累积文本内容
- [ ] 任务描述从累积文本中提取
- [ ] 提取失败时使用备用策略

### AC6: 计费系统
- [ ] 当启用计费且模型配置时计算成本
- [ ] 成本包含输入、输出、缓存三个部分
- [ ] 摘要中显示成本明细行

### AC7: 完成状态处理
- [ ] 插件同时等待完成标志和 Token 可用性
- [ ] 长响应被正确记录，包含完整的 Token 统计
- [ ] 不会用不完整数据提前记录

### AC8: 错误处理
- [ ] 文件写入失败被捕获并记录
- [ ] 插件在错误时不会导致 OpenCode 崩溃
- [ ] 日志记录后内存被正确清理
- [ ] OpenCode 日志不可用时回退到文件日志

### AC9: 兼容性
- [ ] 可在 Bun 运行时工作
- [ ] 可在 Node.js 运行时工作
- [ ] TypeScript 严格模式编译无错误
- [ ] 多种模型格式兼容（providerID/modelID 或字符串）

### AC10: 完整对话日志
- [ ] 当配置 `saveAllLogs: true` 时，收集所有用户输入
- [ ] 当配置 `saveAllLogs: true` 时，收集所有助手输出
- [ ] 会话空闲时写入 all-logs 文件
- [ ] 文件包含带时间戳的完整对话
- [ ] 文件命名为 `opencode-prompt-log-YYYY-MM-DD_<sessionID>.md`

### AC11: 配置
- [ ] 从项目根目录加载配置文件 `opencode-prompt-tracker.config.json`
- [ ] `outputPath` 和 `filePrefix` 可配置
- [ ] `billing` 部分可配置，包含模型定价
- [ ] `saveAllLogs` 布尔选项可配置（默认：false）

---

## 7. 未来增强（超出范围）

1. ~~JSON 导出格式选项~~（已实现计费功能作为替代方案）
2. Webhook 通知新日志
3. 日志聚合仪表板
4. ~~成本计算~~（已实现 F8）
5. 会话比较和分析
6. 日志文件中的过滤/搜索功能
7. CSV 导出用于数据分析
8. 自定义日志格式模板
9. 实时流式日志预览
10. 多输出格式支持（JSON、CSV、HTML）
11. ~~保存完整对话日志~~（已通过 `saveAllLogs` 配置实现 F9）