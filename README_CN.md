# OpenCode Prompt Tracker 插件

一个 OpenCode 插件，可自动将每次对话的提示词、模型、Agent 调用链、耗时和 Token 使用情况，费用情况记录到每次对话的 Markdown 文件中。

## 功能特性

- **自动记录**: 对话完成后自动将每次对话记录到 Markdown 文件
- **Agent 链追踪**: 记录完整的 Agent 调用链（如 `oracle → build → explore`）
- **Token 统计**: 记录 Input/Output Token，并区分缓存与非缓存
- **耗时追踪**: 记录对话处理耗时
- **分步记录**: 每个 Assistant 消息完成时立即记录
- **按日归档**: 按日期自动生成日志文件
- **成本计算**: 可选计费功能（配置后显示成本）
- 
## 特别说明
**本项目完全由OpenCode生成，未经过严格的代码审查和完整的测试。目前只能简单的确认功能基本可用。**

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
git clone https://github.com/CloudStrolling/opencode-prompt-tracker.git
或者
git clone https://gitee.com/CloudStrolling/opencode-prompt-tracker.git

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
cp -r dist/release/* ~/.opencode/plugins/
```

## 使用方法

项目支持零配置启动，安装完成后可在OpenCode启动时自动启用。
零配置时，输出文件默认写入 `<项目目录>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md`

也可以在项目的根目录下新建配置文件：opencode-prompt-tracker.config.json

## 配置

在项目根目录创建 `opencode-prompt-tracker.config.json`：

```json
{
  "outputPath": "prompts",
  "filePrefix": "opencode-prompt-tracker",
  "saveAllLogs": true,
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

| 字段                | 默认值                 | 说明                   |
| ----------------- | ------------------- | -------------------- |
| `outputPath`      | `.opencode/prompts` | 相对于项目根目录的输出目录        |
| `filePrefix`      | `opencode-prompt-`  | 文件名前缀                |
| `saveAllLogs`      | `false`  | 否保存所有的log，如果该选项为true，则在输出目录中额外增加opencode-prompt-log为前缀的md文件，记录ai详细的思考过程。                |
| `billing.enabled` | `false`             | 启用成本计算               |
| `billing.models`  | `[]`                | 模型定价配置（每百万 Token 价格） |

如果billing.enabled为true，并且当前使用的model在models有配置计费规则，摘要中会包含成本行：

```markdown
- **Cost**: $0.0123 (input: $0.005, output: $0.007, cache: $0.0003)
```

没有配置文件时，插件使用所有默认值，与之前行为一致。

### 日志文件格式

```markdown
# Prompt-Tracker

## Prompt
更新详细设计文档，包括中文和英文

### Step 1 — 13:24:15
- **Agent**: ​Sisyphus - Ultraworker
- **Model**: opencode/minimax-m2.5-free
- **Duration**: 11.16s
- **Total Tokens**: 30168 (input: 30001, output: 167)
- **Cached Tokens**: 0 (read: 0, write: 0)
- **Uncached Tokens**: 30001
- **Task**: 更新详细设计文档，包括中文和英文

### Step 2 — 13:24:24
- **Agent**: ​Sisyphus - Ultraworker
- **Model**: opencode/minimax-m2.5-free
- **Duration**: 9.82s
- **Total Tokens**: 3020 (input: 2723, output: 297)
- **Cached Tokens**: 29952 (read: 29952, write: 0)
- **Uncached Tokens**: 0
- **Task**: I found the current DESIGN.md and DESIGN_CN.md files. Let me read them to understand the current state, and also read the source code to understand the full implementation for the design document update

### Step 3 — 13:24:41
- **Agent**: ​Sisyphus - Ultraworker
- **Model**: opencode/minimax-m2.5-free
- **Duration**: 16.39s
- **Total Tokens**: 66792 (input: 66605, output: 187)
- **Cached Tokens**: 0 (read: 0, write: 0)
- **Uncached Tokens**: 66605
- **Task**: 1. 新的 `saveAllLogs` 功能 - 需要记录完整的对话日志

### Step 4 — 13:24:48
- **Agent**: ​Sisyphus - Ultraworker
- **Model**: opencode/minimax-m2.5-free
- **Duration**: 7.31s
- **Total Tokens**: 37404 (input: 37295, output: 109)
- **Cached Tokens**: 32640 (read: 32640, write: 0)
- **Uncached Tokens**: 4655
- **Task**: Let me also check the config.ts and other utility files to have a complete picture

---

### Summary — From 13:24:03 To 13:26:58
- **Model**: opencode/minimax-m2.5-free
- **Agent Chain**: ​Sisyphus - Ultraworker
- **Total Duration**: 174.20s
- **Steps**: 4
- **Total Tokens**: 137384 (input: 136624, output: 760)
- **Cached Tokens**: 62592 (read: 62592, write: 0)
- **Uncached Tokens**: 74032
- **Cost**: $0.3078 (input: $0.2776, output: $0.0114, cache: $0.0188)

```

### 字段说明

| 字段              | 说明                                          |
| --------------- | ------------------------------------------- |
| Time            | 对话开始时间（HH:MM:SS）                            |
| Agent Chain     | 完整的 Agent 调用链，如 `main → code-review → test` |
| Model           | 使用的 AI 模型，如 `opencode/hy3-preview-free`     |
| Prompt          | 用户原始输入文本                                    |
| Duration(s)     | 对话处理耗时（秒）                                   |
| Input Tokens    | 输入 Token 总数（含缓存部分）                          |
| Output Tokens   | 输出 Token 数量                                 |
| Cached Tokens   | 缓存读 + 缓存写 Token 总数                          |
| Uncached Tokens | 输入 Token 减去缓存 Token                         |
| Cache Read      | 从缓存读取的 Token（按折扣计费）                         |
| Cache Write     | 写入缓存的 Token（按溢价计费）                          |



## 开发

### 项目结构

```
opencode-prompt-tracker/
├── src/
│   ├── index.ts              # 主插件入口 — 钩子处理函数
│   ├── types.ts             # TypeScript 类型定义
│   └── utils/
│       ├── file-writer.ts  # 将 .md 日志写入 .opencode/prompts/
│       ├── agent-extractor.ts # 从消息部件中解析 Agent 链
│       ├── logger.ts       # 插件日志输出到 OpenCode 控制台
│       ├── config.ts       # 配置加载器
│       └── billing.ts     # 成本计算
├── tests/                   # 测试文件
├── dist/                    # 构建输出
├── package.json
├── tsconfig.json
├── README.md               # 英文说明文档
├── README_CN.md            # 中文说明文档
├── AGENTS.md              # 开发者指南
└── opencode-prompt-tracker.config.example.json
```

### 开发命令

```bash
npm run build    # 构建 TypeScript + esbuild → dist/release/opencode-prompt-tracker.js
npm run dev     # 监听模式: tsc --watch
npm test       # 使用 Bun 运行测试 (bun test)
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

版权所有 2026 CloudStrolling jenemy