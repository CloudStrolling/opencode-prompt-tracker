# OpenCode Prompt Log Plugin

OpenCode 插件，用于记录每次对话的 Prompt、模型、Agent 调用链、耗时和 Token 使用情况到每日 Markdown 文件中。

## 功能特性

- 📝 **自动记录**: 每次对话结束后自动记录到 Markdown 文件
- 🔗 **Agent 链追踪**: 记录完整的 Agent 调用链（如 `oracle → build → explore`），包括首次调用的 Agent 和通过 Agent 调用的其他 Agent
- 💰 **Token 统计**: 记录 Input/Output Tokens，支持上下文 Token 分别计数
- ⏱️ **耗时统计**: 记录每次对话的耗时
- 📅 **按日归档**: 自动按日期生成日志文件

## 安装

### 方式一：通过 npm 安装（推荐）

1. 在 `opencode.json` 中添加插件配置：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-prompt-log"]
}
```

2. 重启 OpenCode，插件会自动下载并安装。

> **注意**: 插件会安装到 `~/.cache/opencode/node_modules/` 目录，这是 OpenCode 管理 npm 插件的标准位置。

### 方式二：本地安装（开发调试）

适合需要修改插件或参与开发的用户。

#### 前置要求

- OpenCode 编辑器
- Node.js 18+ 或 Bun 运行时

#### 安装步骤

1. 克隆或下载此插件到本地：

```bash
git clone <repository-url> opencode-prompt-log
cd opencode-prompt-log
```

2. 安装依赖：

```bash
npm install
# 或者
bun install
```

3. 构建插件：

```bash
npm run build
# 或者
bun run build
```

4. 将插件复制到 OpenCode 插件目录：

```bash
# 插件目录位置取决于你的 OpenCode 配置
# 通常是 ~/.opencode/plugins/ 或 <项目目录>/.opencode/plugins/
mkdir -p ~/.opencode/plugins/opencode-prompt-log
cp -r dist/* ~/.opencode/plugins/opencode-prompt-log/
```

5. 在 OpenCode 配置中注册插件：

编辑项目根目录或用户目录下的 `opencode.json` 文件，在 `plugin` 数组中添加 `"opencode-prompt-log"`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-prompt-log"
  ]
}
```

如果 `plugin` 数组已存在其他插件，只需追加即可：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-browser",
    "opencode-prompt-log"
  ]
}
```

## 使用方法

安装并重启 OpenCode 后，插件会自动激活。每次对话结束时，插件会：

1. 在 `chat.message` 钩子中捕获用户消息，记录 Prompt 和模型信息
2. 在 `message.updated` 钩子中捕获助手回复，记录耗时和 Token 使用
3. 将信息写入 `<项目目录>/.opencode/prompts/opencode-prompt-YYYY-MM-DD.md`

### 日志文件格式

日志文件采用 Markdown 表格格式：

```markdown
| 时间 | Agent 调用链 | 模型 | Prompt | 耗时(s) | Input Tokens | Output Tokens | Context Tokens | Cache Read | Cache Write |
|------|-------------|------|--------|----------|-------------|---------------|---------------|------------|-------------|
| 10:30:15 | oracle → build | opencode/hy3-preview-free | 设计一个opencode插件... | 12.34 | 150 | 800 | 100 | 0 | 0 |
```

### 字段说明

| 字段 | 说明 |
|------|------|
| 时间 | 对话开始时间（HH:MM:SS） |
| Agent 调用链 | 完整的 Agent 调用链，如 `main → code-review → test` |
| 模型 | 使用的 AI 模型，如 `opencode/hy3-preview-free` |
| Prompt | 用户输入的提示词（换行符替换为 `<br>`） |
| 耗时(s) | 对话处理耗时，单位秒 |
| Input Tokens | 总输入 Token 数 |
| Output Tokens | 输出 Token 数 |
| Context Tokens | 上下文 Token 数（从总输入中分离） |
| Cache Read | 缓存读取的 Token 数 |
| Cache Write | 缓存写入的 Token 数 |

## 开发

### 项目结构

```
opencode-prompt-log/
├── src/
│   ├── index.ts              # 插件入口点
│   ├── types.ts              # 类型定义
│   ├── hooks/
│   │   ├── chat-message.ts  # chat.message 钩子处理
│   │   └── message-updated.ts  # message.updated 钩子处理
│   └── utils/
│       ├── file-writer.ts   # 文件写入工具
│       └── agent-extractor.ts  # Agent 链提取工具
├── tests/                   # 测试文件
├── dist/                    # 构建输出
├── package.json
├── tsconfig.json
└── README.md
```

### 本地编译

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 监视模式开发
npm run dev
```

### 运行测试

```bash
npm test
# 或者
bun test
```

### 本地安装测试

```bash
# 1. 构建插件
npm run build

# 2. 复制到测试项目的插件目录
mkdir -p <test-project>/.opencode/plugins/
cp dist/index.js <test-project>/.opencode/plugins/prompt-log.js

# 3. 在测试项目中启动 OpenCode
cd <test-project>
opencode
```

## npm 发布流程

### 准备工作

1. 确保 `package.json` 中的信息正确：
   - `name`: 包名（必须是 `opencode-prompt-log`）
   - `version`: 版本号
   - `main`: 入口文件（`dist/index.js`）
   - `files`: 包含要发布的文件（`dist/`、`README.md`、`LICENSE`）

2. 确保 `README.md` 和 `LICENSE` 文件存在

### 构建并发布

```bash
# 1. 登录 npm（首次发布需要）
npm login

# 2. 安装依赖并构建
npm install
npm run build

# 3. 发布到 npm
npm publish

# 如果是 scoped package（如 @username/opencode-prompt-log），需要添加 --access public
npm publish --access public
```

### 版本更新

当需要发布新版本时：

```bash
# 1. 更新版本号（patch/minor/major）
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.0 -> 1.1.0
npm version major  # 1.0.0 -> 2.0.0

# 2. 构建
npm run build

# 3. 发布
npm publish
```

### 验证发布

发布后可以在 [npm 官网](https://www.npmjs.com/package/opencode-prompt-log) 查看包信息，或通过以下命令验证：

```bash
npm view opencode-prompt-log
```

## 技术细节

- **钩子**: 使用 `chat.message` 和 `message.updated` 钩子捕获对话
- **数据存储**: 使用 Markdown 表格格式，便于阅读和搜索
- **兼容性**: 同时支持新版 Plugin API 和旧版 activate API
- **运行时**: 同时支持 Bun 和 Node.js 运行时
- **类型安全**: 使用 TypeScript 编写，提供完整的类型定义

## 故障排除

### 插件未加载

1. 检查插件是否正确安装到 OpenCode 插件目录
2. 查看 OpenCode 控制台是否有 `[PromptLog] Plugin activated` 日志
3. 确认 `dist/index.js` 文件已生成

### 日志文件未生成

1. 检查项目目录下是否存在 `.opencode/prompts/` 目录及写入权限
2. 查看 OpenCode 控制台是否有错误信息
3. 确认对话中至少有一个完整的用户-助手交互回合

### TypeScript 编译错误

如果遇到构建错误，尝试：

```bash
# 清理并重新安装
rm -rf node_modules package-lock.json
npm install
npm run build
```

## 许可证

本项目采用 Apache License 2.0 许可证。详见 [LICENSE](./LICENSE) 文件。

Copyright 2026 Your Name

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

## 贡献

欢迎提交 Issue 和 Pull Request！
