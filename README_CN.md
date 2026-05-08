# OpenCode Prompt Recorder 插件

一个 OpenCode 插件，可自动将每次对话的提示词、模型、Agent 调用链、耗时和 Token 使用情况记录到每日 Markdown 文件中。

## 功能特性

- **自动记录**: 对话完成后自动将每次对话记录到 Markdown 文件
- **Agent 链追踪**: 记录完整的 Agent 调用链（如 `oracle → build → explore`）
- **Token 统计**: 记录 Input/Output Token，并区分缓存与非缓存
- **耗时追踪**: 记录对话处理耗时
- **分步记录**: 每个 Assistant 消息完成时立即记录
- **按日归档**: 按日期自动生成日志文件

## 安装

### 方法一：通过 npm 安装（推荐）

在 `opencode.json` 中添加插件配置：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-prompt-tracker"]
}
```

重启 OpenCode，插件会自动下载并安装。

> **注意**: 插件会被安装到 `~/.cache/opencode/node_modules/` 目录。

### 方法二：本地安装（开发调试）

适用于需要修改插件或参与开发的情况。

#### 前置条件

- OpenCode 编辑器
- Node.js 18+ 或 Bun 运行时

#### 安装步骤

```bash
# 克隆插件仓库
git clone <仓库地址> opencode-prompt-tracker
cd opencode-prompt-tracker

# 安装依赖
npm install
# 或
bun install

# 构建插件
npm run build
# 或
bun run build

# 复制到 OpenCode 插件目录
mkdir -p ~/.opencode/plugins/opencode-prompt-tracker
cp -r dist/* ~/.opencode/plugins/opencode-prompt-tracker/

# 在 opencode.json 中注册
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-prompt-tracker"]
}
```

## 使用方法

安装后插件会自动启用。它会捕获：

1. 用户消息通过 `chat.message` 钩子 — 记录提示词、模型、Agent 链
2. Assistant 响应通过 `event.message.updated` — 立即记录每个步骤
3. 会话结束通过 `event.session.idle` — 写入最终摘要

输出文件写入到 `<项目目录>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md`

### 日志文件格式

```markdown
# Prompt Recorder - Session

### Prompt
设计一个记录提示词的 OpenCode 插件...

### Step 1 — 10:30:15
- **Agent**: oracle
- **Model**: opencode/hy3-preview-free
- **Duration**: 12.34s
- **Total Tokens**: 950 (input: 150, output: 800)
- **Cached Tokens**: 100 (read: 0, write: 100)
- **Uncached Tokens**: 50
- **Task**: 分析认证模块结构

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

### 字段说明

| 字段 | 说明 |
|------|------|
| Time | 对话开始时间（HH:MM:SS） |
| Agent Chain | 完整的 Agent 调用链，如 `main → code-review → test` |
| Model | 使用的 AI 模型，如 `opencode/hy3-preview-free` |
| Prompt | 用户原始输入文本 |
| Duration(s) | 对话处理耗时（秒） |
| Input Tokens | 输入 Token 总数（含缓存部分） |
| Output Tokens | 输出 Token 数量 |
| Cached Tokens | 缓存读 + 缓存写 Token 总数 |
| Uncached Tokens | 输入 Token 减去缓存 Token |
| Cache Read | 从缓存读取的 Token（按折扣计费） |
| Cache Write | 写入缓存的 Token（按溢价计费） |

## 开发

### 项目结构

```
opencode-prompt-tracker/
├── src/
│   ├── index.ts              # 主插件入口 — 钩子处理函数
│   ├── types.ts             # TypeScript 类型定义
│   │   └── utils/
│       ├── file-writer.ts  # 将 .md 日志写入 .opencode/prompts/
│       ├── agent-extractor.ts # 从消息部件中解析 Agent 链
│       └── logger.ts       # 插件日志输出到 OpenCode 控制台
├── tests/                   # 测试文件
├── dist/                    # 构建输出
├── package.json
├── tsconfig.json
├── README.md               # 英文说明文档
├── README_CN.md            # 中文说明文档
└── AGENTS.md              # 开发者指南
```

### 开发命令

```bash
npm run build    # 构建 TypeScript + esbuild → dist/release/opencode-prompt-tracker.js
npm run dev     # 监听模式: tsc --watch
npm test        # 使用 Bun 运行测试 (bun test)
```

### 本地测试

```bash
# 1. 构建插件
npm run build

# 2. 复制到测试项目
mkdir -p <测试项目>/.opencode/plugins/
cp dist/release/opencode-prompt-tracker.js <测试项目>/.opencode/plugins/

# 3. 在 opencode.json 中添加
{ "plugin": ["opencode-prompt-tracker"] }
```

## 发布

```bash
# 更新版本（patch/minor/major）
npm version patch

# 构建
npm run build

# 发布
npm publish
# 对于作用域包：
npm publish --access public
```

## 技术细节

- **钩子**: `chat.message`, `event.message.part.updated`, `event.message.updated`, `event.session.idle`
- **数据存储**: Markdown 格式，包含步骤条目和摘要
- **运行时**: 支持 Bun 和 Node.js
- **类型安全**: TypeScript 严格模式

## 许可证

基于 Apache License 2.0 许可证发布。详见 [LICENSE](./LICENSE) 文件。

版权所有 2026 OpenCode Prompt Recorder 贡献者