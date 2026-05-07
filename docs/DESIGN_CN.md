# OpenCode Prompt Log Plugin — 设计文档

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
│                      PromptLogPlugin（入口点）                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  sessionStates (Map<string, SessionState>)                         │   │
│  │  - 内存中存储活动会话                                               │   │
│  │  - 最多 100 个会话（LRU 淘汰）                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│              ┌─────────────────────┼─────────────────────┐               │
│              │                     │                     │               │
│              ▼                     ▼                     ▼               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │  chat.message   │  │      event       │  │    工具模块      │       │
│  │    钩子          │  │      钩子         │  │                  │       │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
│              │                     │                     │               │
│              └─────────────────────┼─────────────────────┘               │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       工具模块                                        │   │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐     │   │
│  │  │  file-writer.ts  │ │agent-extractor.ts│ │   logger.ts     │     │   │
│  │  │                  │ │                  │ │                 │     │   │
│  │  │  - Markdown I/O │ │ - Agent 链      │ │ - 客户端日志    │     │   │
│  │  │  - 文件路径     │ │   提取          │ │ - 备用文件     │     │   │
│  │  │  - 目录管理     │ │ - Parts 解析    │ │                 │     │   │
│  │  └─────────────────┘ └─────────────────┘ └─────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    输出：Markdown 文件                              │   │
│  │  <project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<session>.md│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 模块职责

| 模块 | 职责 | 公共 API |
|------|------|----------|
| `index.ts` | 主插件入口，钩子处理器，会话状态管理 | `PromptLogPlugin()` |
| `types.ts` | 所有数据结构的 TypeScript 接口 | 导出接口 |
| `file-writer.ts` | Markdown 文件 I/O，步骤和摘要日志 | `appendStepToPromptLog()`, `appendToPromptLog()` |
| `agent-extractor.ts` | 解析消息部分以获取 Agent 信息 | `extractAgentChain()` |
| `logger.ts` | 带备用功能的日志抽象 | `initLogger()`, `logInfo()`, `logError()` |

---

## 2. 模块设计详解

### 2.1 主入口点（index.ts）

**目的**：插件工厂函数，初始化插件并返回钩子处理器。

**主要职责**：
1. 使用客户端和目录初始化日志器
2. 管理会话状态生命周期（创建、更新、清理）
3. 处理 chat.message 钩子（会话初始化）
4. 处理 event 钩子（步骤日志、摘要写入）
5. 协调钩子之间的完整工作流

**核心函数**：

```typescript
// 主插件工厂
PromptLogPlugin({
  client: any,
  directory: string
}): Promise<{
  'chat.message': (input: any, output: any) => Promise<void>,
  event: ({ event }: { event: any }) => Promise<void>
}>
```

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
message.updated（助手完成）
    │
    ▼
写入步骤日志，累加 Token
    │
    ▼
session.idle（会话结束）
    │
    ▼
写入摘要，清理 SessionState
```

### 2.2 类型定义（types.ts）

**目的**：定义插件中使用的所有 TypeScript 接口。

**定义的接口**：
1. `MessageStep` - 单个助手消息步骤数据
2. `SessionState` - 内存中会话跟踪数据
3. `LogData` - 写入文件的摘要数据

**设计原理**：
- 内存中数据与持久化数据结构的分离
- SessionState 中的累计字段用于步骤聚合
- 只读 LogData 用于干净的写操作

### 2.3 文件写入器（file-writer.ts）

**目的**：处理所有 Markdown 文件 I/O 操作。

**关键函数**：

```typescript
// 写入步骤条目（每个助手消息调用一次）
appendStepToPromptLog(
  directory: string,
  sessionID: string,
  sessionStartTime: string,
  step: MessageStep,
  isFirstStep: boolean,
  prompt: string
): Promise<void>

// 写入摘要条目（每个会话调用一次）
appendToPromptLog(
  directory: string,
  data: LogData,
  sessionState: SessionState
): Promise<void>
```

**文件格式设计**：
```
# Prompt Log - Session

### Prompt
<用户原始提示词>

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

**运行时抽象**：
- 通过 `typeof Bun !== 'undefined'` 检测运行时
- Bun: 使用 `Bun.file()` API
- Node.js: 使用 `fs` 模块
- 两者都支持异步操作

### 2.4 Agent 提取器（agent-extractor.ts）

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

### 2.5 日志器（logger.ts）

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
                   │                    message.updated                │
                   │◀─────────────────────────────────────────────────│
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ 事件处理器：     │                │                         │
          │ - 验证          │                │                         │
          │   完成状态      │                │                         │
          │ - 提取 tokens  │                │                         │
          │ - 写入步骤      │                │                         │
          │ - 累加          │                │                         │
          └────────┬────────┘                │                         │
                   │                         │                         │
                   │                    session.idle                  │
                   │◀─────────────────────────────────────────────────│
                   │                         │                         │
                   ▼                         │                         │
          ┌─────────────────┐                │                         │
          │ 写入摘要：      │                │                         │
          │ - 计算          │                │                         │
          │   耗时          │                │                         │
          │ - 聚合          │                │                         │
          │   tokens        │                │                         │
          │ - 写入文件      │                │                         │
          │ - 清理内存     │                │                         │
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
                                    │   用户查看      │
                                    │   日志文件      │
                                    └─────────────────┘
```

### 3.2 Token 提取流程

```
助手消息信息
        │
        ▼
┌───────────────────┐
│ 有 info.tokens?   │──是──▶ 使用主要结构
└────────┬──────────┘            (input, output, cache)
         │ 否
         ▼
┌───────────────────┐
│ 有 info.usage?    │──是──▶ 使用旧结构
└────────┬──────────┘            (prompt_tokens, completion_tokens)
         │ 否
         ▼
┌───────────────────┐
│ 跳过此事件        │（等待下一个带有 token 数据的事件）
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

### 4.2 钩子输入/输出模式

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

---

## 6. 安全性考虑

### 6.1 数据隐私
- 日志包含用户提示词 - 考虑谁可以访问 .opencode/prompts/ 目录
- 无敏感数据过滤（如需要，用户负责清理）
- 仅本地文件存储，无网络传输

### 6.2 文件访问
- 插件写入项目 .opencode/prompts/ 子目录
- 无法访问指定日志目录之外的文件
- 与标准文件权限模型兼容

---

## 7. 性能优化

### 7.1 异步文件操作
- 所有文件 I/O 都是异步的（非阻塞）
- Bun: 原生异步文件 API
- Node.js: 异步 fs 方法

### 7.2 字符串连接
- 在可能的情况下预分配内容字符串
- 使用模板字面量进行格式化
- 热路径中最少化字符串分配

### 7.3 内存效率
- SessionState 使用 Set 进行 O(1) 成员检查
- 最多 100 个会话的硬限制
- 会话结束时的清理防止内存泄漏

---

## 8. 测试策略

### 8.1 单元测试
- agent-extractor.ts - Agent 链提取逻辑
- file-writer.ts - Markdown 格式化（模拟 fs）
- 各个函数的逻辑

### 8.2 集成测试
- 完整插件生命周期（模拟 OpenCode 钩子）
- 文件输出验证
- 多步骤处理

### 8.3 手动测试
- 真实 OpenCode 会话捕获
- 日志文件内容验证
- 边界情况探索

---

## 9. 配置和扩展点

### 9.1 构建配置
- 使用严格模式的 TypeScript 编译
- esbuild 打包用于分发
- 输出：ESM 格式，兼容 Bun/Node

### 9.2 扩展点（未来）
- 自定义日志格式模板
- 额外的元数据字段
- Webhook 通知
- 导出格式选项（JSON、CSV）