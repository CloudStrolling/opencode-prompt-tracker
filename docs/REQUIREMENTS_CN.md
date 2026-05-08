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
- 会话空闲（通过 `session.idle` 事件捕获）

**输出位置**：写入 `<project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md`

**捕获的数据**：
- 用户提示词文本
- AI 模型标识符
- Agent 调用链
- 处理耗时
- Token 使用情况（输入、输出、上下文、缓存读写）

#### F2: Agent 链追踪
**描述**：记录完整的 Agent 调用链（例如：`oracle → build → explore`）。

**范围**：包括首次调用的 Agent 和通过其他 Agent 调用的子 Agent。

**数据来源**：
- 来自 chat.message 钩子的 `input.agent`
- 来自 `output.parts` 数组的 agent 和 subtask 类型

**提取逻辑**：
- 直接 Agent 调用：`{ type: 'agent', name: 'agentName' }`
- 通过 Agent 的子任务：`{ type: 'subtask', agent: 'agentName' }`

**输出格式**：箭头分隔的字符串（例如：'oracle → build → explore'）

#### F3: Token 统计
**描述**：为每次对话记录详细的 Token 使用信息。

**字段说明**：
| 字段 | 描述 |
|------|------|
| 输入 Token | 对话消耗的总输入 Token 数量 |
| 输出 Token | 助手生成的总输出 Token 数量 |
| 上下文 Token | 上下文 Token 数量（从总输入中分离） |
| 缓存读取 | 从缓存中读取的上下文 Token |
| 缓存写入 | 为未来使用写入缓存的 Token |

**数据来源**：
- 主要来源：`info.tokens` 结构（input、output、context、cache.read、cache.write）
- 备用来源：`info.usage` 结构（prompt_tokens、completion_tokens 等）

**提取逻辑**：
- 从 `info.tokens.input` 和 `info.tokens.output` 提取
- 备用至 `info.usage.prompt_tokens` / `info.usage.completion_tokens`
- 处理新旧两种数据结构

#### F4: 耗时追踪
**描述**：记录每次对话从开始到完成的处理耗时。

**计算方式**：`结束时间 - 开始时间`（单位：秒，保留 2 位小数）

**开始时间捕获**：
- 用户发送消息时捕获
- 来源：`chat.message` 钩子时间戳

**结束时间捕获**：
- 助手响应完成时捕获
- 来源：`message.updated` 事件时间戳

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
- Agent 名称
- 使用的模型
- 完成时间
- 耗时
- 该步骤的 Token 计数

---

### 2.2 用户交互和钩子

#### 钩子：chat.message
**目的**：捕获用户发送的消息，记录初始会话状态。

**执行的操作**：
1. 从 `output.parts` 提取提示词文本（筛选文本类型部分）
2. 从 `input.model` 提取模型信息（支持对象和字符串格式）
3. 从 `input.agent` 构建初始 Agent 链
4. 使用 agent-extractor 从 `output.parts` 提取额外的 Agent
5.将会话状态存储在内存中（sessionStates Map）
6. 内存管理：保留最近的 100 个会话

**存储在 SessionState 中的数据**：
- userMsgID、prompt、model、startTime、agentChain、sessionStartTime
- 累计字段：totalInputTokens、totalOutputTokens、totalContextTokens、totalCacheRead、totalCacheWrite
- 跟踪字段：completedMessageIDs、stepCount、headerWritten、hasCompletedMessage

#### 钩子：event
**目的**：监控助手消息完成、会话空闲和状态转换。

**处理的事件类型**：
| 事件类型 | 操作 |
|----------|------|
| message.updated | 处理已完成的助手消息，写入步骤日志，累加 Token |
| session.idle | 写入累计总数的摘要日志，清理会话状态 |
| session.status (type=idle) | 摘要日志的备用触发器 |

**完成检查逻辑**：
- 检查 `info.time?.completed` 标志
- 确保 Token 统计可用（`info.tokens` 或 `info.usage`）
- 在写入日志前等待两个条件都满足（防止数据不完整）

**步骤处理**：
- 验证消息角色为 'assistant'
- 跳过已处理的消息（使用 completedMessageIDs Set）
- 提取 Token，增加步骤计数，写入步骤日志
- 将会话 Token 累加到总数
- 从该消息更新 lastModel

---

### 2.3 数据结构

#### SessionState（内存中）
```typescript
interface SessionState {
  userMsgID: string;           // 用户消息的唯一标识符
  prompt: string;             // 用户的提示词文本
  model: string;              // AI 模型标识符（初始值）
  startTime: number;          // 会话开始时的 Unix 时间戳（毫秒）
  agentChain: string[];       // Agent 调用链数组
  sessionStartTime: string;   // 日期字符串（YYYY-MM-DD）
  completedMessageIDs: Set<string>;  // 已处理的消息 ID，用于避免重复计数
  totalInputTokens: number;   // 累计输入 Token
  totalOutputTokens: number;  // 累计输出 Token
  totalContextTokens: number; // 累计上下文 Token
  totalCacheRead: number;      // 累计缓存读取 Token
  totalCacheWrite: number;    // 累计缓存写入 Token
  lastModel: string;          // 最近消息的模型
  hasCompletedMessage: boolean; // 是否有至少一条消息完成
  stepCount: number;          // 已完成步骤数
  headerWritten: boolean;     // 是否已写入文件头
}
```

#### MessageStep（每个步骤）
```typescript
interface MessageStep {
  stepNumber: number;         // 步骤编号（从 1 开始）
  messageID: string;          // 唯一消息标识符
  agent: string;              // 此步骤的 Agent 名称
  model: string;             // 此步骤使用的模型
  time: string;               // 格式化时间（HH:MM:SS）
  duration: string;           // 耗时（秒）
  inputTokens: number;        // 此步骤的输入 Token
  outputTokens: number;       // 此步骤的输出 Token
  contextTokens: number;      // 此步骤的上下文 Token
  cacheRead: number;          // 此步骤的缓存读取 Token
  cacheWrite: number;         // 此步骤的缓存写入 Token
}
```

#### LogData（用于摘要写入）
```typescript
interface LogData {
  sessionID: string;          // 会话标识符
  time: string;               // 格式化时间（HH:MM:SS）
  agentChain: string;         // Agent 链（箭头分隔）
  model: string;             // AI 模型标识符
  prompt: string;             // 用户原始提示词
  duration: string;          // 耗时（秒）
  steps: number;             // 已完成步骤数
  inputTokens: number;       // 总输入 Token 数量
  outputTokens: number;       // 总输出 Token 数量
  contextTokens: number;      // 总上下文 Token 数量
  cacheRead: number;          // 总缓存读取 Token
  cacheWrite: number;         // 总缓存写入 Token
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

---

## 3. 非功能需求

### 3.1 性能
- 对 OpenCode 响应时间的影响最小化
- 异步文件写入（非阻塞）
- 高效的内存使用（最多 100 个会话）
- 从消息信息中快速提取 Token

### 3.2 可靠性
- 文件写入失败的错误处理
- 当 OpenCode 客户端日志不可用时回退到文件日志
- 成功日志记录后会话状态清理（防止内存泄漏）
- 数据不完整时的优雅降级

### 3.3 兼容性
- OpenCode 插件 API（主要）
- 旧版激活 API（备用）
- Bun 运行时（主要，已优化）
- Node.js 运行时（备用）
- 完整的 TypeScript 类型定义

### 3.4 可维护性
- 清晰的模块分离（index、types、utils）
- 全面的 JSDoc 注释
- 所有数据结构的类型安全接口
- 核心工具的单元测试

---

## 4. 用户故事

| 编号 | 用户故事 | 验收标准 |
|------|----------|----------|
| US1 | 作为一个开发者，我希望自动记录我的 OpenCode 对话，以便稍后查看我的 AI 使用历史 | 每次对话都在 .opencode/prompts/ 中创建 Markdown 文件 |
| US2 | 作为一个团队负责人，我希望看到对话中使用了哪些 Agent，以便了解工作流模式 | Agent 链被捕获并显示在日志文件中 |
| US3 | 作为一个注重成本的用户，我希望跟踪每次对话的 Token 使用情况，以便监控我的 AI 支出 | Token 计数（输入、输出、上下文、缓存）被准确记录 |
| US4 | 作为一个性能分析师，我希望看到每次对话需要多长时间，以便识别瓶颈 | 耗时被计算并以秒为单位记录 |
| US5 | 作为一个研究人员，我希望有每日日志文件，以便按日期组织和分析数据 | 文件使用日期前缀（YYYY-MM-DD）命名 |
| US6 | 作为一个 Agent 工作流用户，我希望看到每个步骤的详细信息，以便了解多步骤过程 | 每个助手消息被记录为单独的步骤 |

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
│  - 从 output.parts 提取提示词                                               │
│  - 从 input.model 提取模型                                                 │
│  - 从 input.agent + output.parts 提取 Agent 链                            │
│  - 在内存中存储 SessionState                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      助手生成响应                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    message.updated 事件触发                                │
│  - 验证完成状态（info.time.completed）                                     │
│  - 验证 Token 可用性（info.tokens 或 info.usage）                         │
│  - 从消息信息中提取 Token、Agent、模型                                     │
│  - 立即写入步骤日志                                                        │
│  - 将会话 Token 累加到总数                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       会话进入空闲状态                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    session.idle 事件触发                                    │
│  - 计算总耗时                                                              │
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

### AC2: 数据完整性
- [ ] 所有字段都被记录：时间、模型、Agent 链、提示词、耗时、Token（输入/输出/上下文/缓存读取/缓存写入）
- [ ] Token 计数与消息信息中的实际使用量匹配
- [ ] 耗时被准确计算（结束时间 - 开始时间）

### AC3: Agent 链
- [ ] 捕获输入上下文中的主 Agent
- [ ] 捕获消息部分中的子 Agent
- [ ] Agent 链格式化为箭头分隔的字符串

### AC4: 多步骤处理
- [ ] 每个助手消息被记录为单独的步骤
- [ ] 步骤按顺序编号
- [ ] Token 在步骤间累计
- [ ] 会话空闲后写入摘要

### AC5: 完成状态处理
- [ ] 插件同时等待完成标志和 Token 可用性
- [ ] 长响应被正确记录，包含完整的 Token 统计
- [ ] 不会用不完整数据提前记录

### AC6: 错误处理
- [ ] 文件写入失败被捕获并记录
- [ ] 插件在错误时不会导致 OpenCode 崩溃
- [ ] 日志记录后内存被正确清理

### AC7: 兼容性
- [ ] 可在 Bun 运行时工作
- [ ] 可在 Node.js 运行时工作
- [ ] TypeScript 编译无错误

---

## 7. 未来增强（超出范围）

1. JSON 导出格式选项
2. 新日志的 Webhook 通知
3. 日志聚合仪表板
4. 基于 Token 定价的成本计算
5. 会话比较和分析
6. 日志文件中的过滤/搜索功能
7. 用于数据分析的 CSV 导出
8. 自定义日志格式模板