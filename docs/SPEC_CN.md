# OpenCode Prompt Tracker 插件 - 规格说明书

## 1. 项目概述

### 项目名称
OpenCode Prompt Tracker 插件

### 项目类型
OpenCode 插件（TypeScript/JavaScript）

### 核心功能概述
一个 OpenCode 插件，可自动将每次对话的提示词、模型、Agent 调用链、耗时和 Token 使用情况记录到每日 Markdown 文件中。

### 目标用户
- 希望追踪 AI 使用情况的 OpenCode 用户
- 需要分析对话模式的开发者
- 监控 Token 消耗和成本的团队

---

## 2. 功能需求

### 2.1 核心功能

#### F1: 自动对话记录
- **描述**: 对话结束后自动将每次用户与助手的对话记录到 Markdown 文件
- **触发条件**: 助手消息完成且包含 Token 统计数据时
- **输出位置**: 写入到 `<project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md`

#### F2: Agent 链追踪
- **描述**: 记录完整的 Agent 调用链（如 `oracle → build → explore`）
- **范围**: 包含首次调用的 Agent 和通过其他 Agent 调用的子 Agent
- **数据来源**: 从 `input.agent` 和 `output.parts` 提取（agent/subtask 类型）

#### F3: Token 统计
- **描述**: 记录详细的 Token 使用信息
- **字段**:
  - Input Tokens: 输入 Token 总数
  - Output Tokens: 输出 Token 总数
  - Context Tokens: 上下文 Token 数量（从输入中分离）
  - Cache Read: 从缓存读取的 Token
  - Cache Write: 写入缓存的 Token
- **数据来源**:
  - 主要来源: `info.tokens` 结构（input, output, cache）
  - 备用来源: `info.usage` 结构（prompt_tokens, completion_tokens 等）

#### F4: 耗时追踪
- **描述**: 记录每次对话的处理耗时
- **计算方式**: 结束时间 - 开始时间（秒，保留 2 位小数）
- **开始时间**: 用户发送消息时捕获（`chat.message` 钩子）
- **结束时间**: 助手响应完成时捕获（`message.updated` 事件）

#### F5: 每日文件归档
- **描述**: 自动生成按日期组织的日志文件
- **文件命名**: `opencode-prompt-YYYY-MM-DD_<sessionID>.md`
- **会话处理**: 同一会话中的多次交互追加到同一文件

### 2.2 用户交互

#### 钩子: chat.message
- **用途**: 捕获用户发送的消息
- **操作**:
  1. 从 `output.parts` 提取提示词文本
  2. 从 `input.model` 提取模型信息
  3. 从 `input.agent` 构建初始 Agent 链
  4. 从 `output.parts` 提取额外的 Agent
  5. 在内存中存储会话状态（sessionStates Map）
  6. 内存管理：保留最近 100 个会话

#### 钩子: event
- **用途**: 监控助手消息完成情况
- **处理的事件类型**:
  - `message.part.updated`: 累积增量文本（未来使用）
  - `message.updated`: 处理助手完成消息
- **完成检查**:
  - 检查 `info.time?.completed` 或 `info.finish`
  - 确保 Token 统计可用（`hasTokens`）
  - 在两个条件都满足时才记录

### 2.3 数据结构

#### SessionState（内存中）
```typescript
interface SessionState {
  userMsgID: string;      // 用户消息 ID
  prompt: string;         // 用户提示词文本
  model: string;          // AI 模型标识符
  startTime: number;      // Unix 时间戳（毫秒）
  agentChain: string[];   // Agent 调用链
  sessionStartTime: string; // 日期字符串（YYYY-MM-DD）
}
```

#### LogData（写入用）
```typescript
interface LogData {
  sessionID: string;       // 会话标识符
  time: string;           // 格式化时间（HH:MM:SS）
  agentChain: string;     // Agent 链（箭头分隔）
  model: string;          // AI 模型标识符
  prompt: string;        // 用户提示词
  duration: string;       // 耗时（秒）
  inputTokens: number;    // 输入 Token ���量
  outputTokens: number;   // 输出 Token 数量
  contextTokens: number; // 上下文 Token 数量
  cacheRead: number;      // 缓存读取 Token
  cacheWrite: number;     // 缓存写入 Token
}
```

### 2.4 边界情况

1. **长响应**: 插件等待 Token 统计就绪后才写入（不仅是完成标志）
2. **内存管理**: 内存中最多存储 100 个会话，超出时删除最旧的
3. **无会话状态**: 如找不到会话状态则跳过记录（可能已被清理）
4. **缺失 Token**: 如 Token 数据不可用则跳过记录，等待下一个事件
5. **文件创建**: 如不存在则自动创建 `.opencode/prompts/` 目录
6. **模型格式**: 支持对象格式（providerID/modelID）和字符串格式
7. **运行时兼容性**: 支持 Bun 和 Node.js 运行时

---

## 3. 非功能需求

### 3.1 性能
- 对 OpenCode 响应时间影响最小
- 异步文件写入（非阻塞）
- 高效的内存使用（最多 100 个会话）

### 3.2 可靠性
- 文件写入失败的错误处理
- OpenCode 客户端日志不可用时的备用日志
- 成功记录后会话状态清理

### 3.3 兼容性
- OpenCode 插件 API（新）
- 遗留激活 API（备用）
- Bun 运行时（主要）
- Node.js 运行时（备用）
- 带有完整类型定义的 TypeScript

---

## 4. 系统架构

### 4.1 模块结构

```
opencode-prompt-tracker/
├── src/
│   ├── index.ts              # 主插件入口，钩子处理器
│   ├── types.ts             # TypeScript 接口
│   └── utils/
│       ├── file-writer.ts  # Markdown 文件写入
│       ├── agent-extractor.ts # Agent 链提取
│       └── logger.ts        # 日志工具
├── dist/                   # 构建输出
├── package.json            # NPM 配置
└── README.md              # 文档
```

### 4.2 数据流

```
用户发送消息（chat.message）
         ↓
提取提示词、模型、Agent 链
         ↓
在内存中存储 SessionState
         ↓
助手响应（message.updated 事件）
         ↓
检查完成 + Token 可用性
         ↓
提取 Token 统计，计算耗时
         ↓
写入 Markdown 文件
         ↓
清理内存中的 SessionState
```

### 4.3 关键函数

| 函数 | 职责 |
|----------|-------------|
| `PromptRecorderPlugin()` | 主插件工厂，返回钩子 |
| `chat.message` 钩子 | 捕获用户消息，存储会话状态 |
| `event` 钩子 | 监控完成，写入日志条目 |
| `extractPromptFromParts()` | 从消息部件提取文本 |
| `extractModelFromInput()` | 提取模型标识符 |
| `extractAgentChain()` | 从部件提取 Agent 名称 |
| `appendToPromptRecorder()` | 将日志条目写入 Markdown 文件 |
| `formatLogEntry()` | 格式化为 Markdown |
| `initLogger()` | 初始化日志系统 |
| `logInfo()` / `logError()` | 带备用的日志消息 |

---

## 5. 输出格式

### Markdown 日志文件格式

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
设计一个记录提示词的 OpenCode 插件...

---
```

### 字段说明

| 字段 | 说明 |
|-------|-------------|
| Time | 对话开始时间（HH:MM:SS） |
| Model | AI 模型标识符 |
| Agent Chain | 完整的 Agent 调用链（箭头分隔） |
| Duration | 处理耗时（秒） |
| Input Tokens | 输入 Token 总数 |
| Output Tokens | 输出 Token 总数 |
| Context Tokens | 上下文 Token 数量（来自输入） |
| Cache Read | 从缓存读取的 Token |
| Cache Write | 写入缓存的 Token |
| Prompt | 用户原始输入文本 |

---

## 6. 验收标准

### AC1: 基础记录
- [ ] 每次对话都记录到 Markdown 文件
- [ ] 文件创建在 `.opencode/prompts/` 目录
- [ ] 文件命名遵循 `opencode-prompt-YYYY-MM-DD_<sessionID>.md` 模式

### AC2: 数据完整性
- [ ] 记录所有 9 个字段（time, model, agentChain, prompt, duration, tokens x5）
- [ ] Token 计数与实际使用匹配
- [ ] 耗时计算准确

### AC3: Agent 链
- [ ] 捕获输入上下文中的主要 Agent
- [ ] 捕获消息部件中的子 Agent
- [ ] Agent 链格式化为箭头分隔字符串

### AC4: 完成处理
- [ ] 插件等待完成标志和 Token 可用性都满足
- [ ] 长响应正确记录完整的 Token 统计
- [ ] 不会过早记录不完整数据

### AC5: 错误处理
- [ ] 捕获并记录文件写入失败
- [ ] 插件不会导致 OpenCode 崩溃
- [ ] 记录后正确清理内存

### AC6: 兼容性
- [ ] 支持 Bun 运行时
- [ ] 支持 Node.js 运行时
- [ ] TypeScript 编译无错误

---

## 7. 未来增强（超出范围）

1. JSON 导出格式选项
2. 新日志的 Webhook 通知
3. 日志聚合仪表板
4. 基于 Token 价格计算成本
5. 会话比较和分析
6. 日志文件中的过滤/搜索功能