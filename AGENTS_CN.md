# 项目知识库

**生成时间**: 2026-05-09
**项目**: OpenCode Prompt Tracker 插件

## 概述

OpenCode 插件，用于将提示词、模型、代理、运行时长和 Token 使用量记录到每日 Markdown 文件中。

## 项目结构

```
src/
├── index.ts              # 主插件 —— PromptRecorderPlugin 工厂 + 钩子
├── types.ts              # TypeScript 接口定义
└── utils/                # 工具模块 (见 src/utils/AGENTS.md)

tests/                    # Bun 测试套件
dist/release/             # 构建输出 (esbuild 打包)
```

## 代码地图

| 符号 | 类型 | 位置 |
|--------|------|----------|
| `PromptRecorderPlugin` | function | src/index.ts:355 |
| `SessionState` | interface | src/types.ts:45 |
| `MessageStep` | interface | src/types.ts:10 |
| `LogData` | interface | src/types.ts:138 |
| `appendStepToPromptRecorder` | function | src/utils/file-writer.ts:115 |
| `loadConfig` | function | src/utils/config.ts:28 |

## 钩子

| 钩子 | 用途 |
|------|---------|
| `chat.message` | 捕获用户输入，初始化会话状态 |
| `event: message.part.updated` | 收集任务描述文本 |
| `event: message.updated` | 助手完成后写入步骤日志 |
| `event: session.idle` | 写入汇总信息 |

## 命令

```bash
npm run build    # tsc → dist/ + esbuild → dist/release/opencode-prompt-tracker.js
npm run dev      # 监听模式: tsc --watch
npm test         # Bun 测试套件 (bun test)
npm publish       # npm version patch && npm run build && npm publish --access public
```

## 项目规范

- **格式化**: Prettier — 单引号、分号、2 空格、100 字符宽度
- **TypeScript**: 严格模式 (`tsconfig.json`)
- **运行时**: Bun + Node.js 双支持 (通过 `typeof Bun !== 'undefined'`)
- **构建顺序**: `tsc` → `dist/`，然后 `esbuild` → `dist/release/`

## 本地测试

```bash
# 构建 → 复制 → 添加到 opencode.json
npm run build
cp dist/release/opencode-prompt-tracker.js <test-project>/.opencode/plugins/
# 然后在 opencode.json 中添加: { "plugin": ["opencode-prompt-tracker"] }
```

## 备注

- 配置文件: `<project>/opencode-prompt-tracker.config.json` (可选)
- 输出文件: `<project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md`
- 会话清理: 空闲时自动清理，内存中最多 100 个并发会话