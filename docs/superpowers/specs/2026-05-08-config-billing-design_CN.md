# 配置和计费功能设计

**日期**: 2026-05-08
**作者**: Sisyphus
**状态**: 已批准

## 1. 概述

为 OpenCode Prompt Tracker 插件添加配置模块和计费计算功能。

- **配置文件**: 项目根目录中的 `opencode-prompt-tracker.config.json`
- **配置项**: 输出路径、文件前缀、计费设置
- **计费功能**: 启用时在摘要中计算和显示成本

## 2. 配置设计

### 2.1 文件位置

**路径**: `<project>/opencode-prompt-tracker.config.json`

理由：与 OpenCode 的 `opencode.json` 分开，明确限定仅此插件使用。

### 2.2 配置模式

```json
{
  "outputPath": ".opencode/prompts",
  "filePrefix": "opencode-prompt-",
  "billing": {
    "enabled": false,
    "models": []
  }
}
```

### 2.3 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|-------------|
| `outputPath` | `string` | `.opencode/prompts` | 从项目根目录到输出目录的相对路径 |
| `filePrefix` | `string` | `opencode-prompt-` | 生成的 markdown 文件名的前缀 |
| `billing.enabled` | `boolean` | `false` | 计费功能的主开关 |
| `billing.models` | `array` | `[]` | 模型定价配置列表 |

### 2.4 模型定价配置

```json
{
  "model": "opencode/hy3-preview-free",
  "input": 0.0,
  "output": 0.0,
  "cacheRead": 0.0,
  "cacheWrite": 0.0
}
```

| 字段 | 单位 | 说明 |
|-------|------|-------------|
| `model` | - | 完整模型名称，必须与 markdown 中的 `model` 字段匹配 |
| `input` | $/1M Token | 每百万输入 Token（未缓存）的价格 |
| `output` | $/1M Token | 每百万输出 Token 的价格 |
| `cacheRead` | $/1M Token | 每百万缓存命中读取 Token 的价格 |
| `cacheWrite` | $/1M Token | 每百万缓存命中写入 Token 的价格 |

### 2.5 零配置行为

**规则**: 配置文件不存在或配置字段缺失时，使用默认值。

| 场景 | 行为 |
|----------|----------|
| 配置文件缺失 | 使用所有默认值 |
| `outputPath` 缺失 | 使用 `.opencode/prompts` |
| `filePrefix` 缺失 | 使用 `opencode-prompt-` |
| `billing` 部分缺失 | 计费禁用 |
| 模型未在配置中 | 该模型不计算成本 |

## 3. 模块设计

### 3.1 新增文件

| 文件 | 用途 |
|------|---------|
| `src/utils/config.ts` | 配置文件加载、默认值合并、验证 |
| `src/utils/billing.ts` | 成本计算逻辑 |

### 3.2 修改的文件

| 文件 | 变更 |
|------|---------|
| `src/types.ts` | 添加配置相关接口 |
| `src/index.ts` | 加载配置，传递给 file-writer，在摘要中计算计费 |
| `src/utils/file-writer.ts` | 接受配置以获取 outputPath 和 filePrefix |

## 4. 类型定义

```typescript
// 配置接口
export interface BillingModelConfig {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface BillingConfig {
  enabled: boolean;
  models: BillingModelConfig[];
}

export interface PromptRecorderConfig {
  outputPath: string;
  filePrefix: string;
  billing: BillingConfig;
}

// 步骤的成本明细
export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheCost: number;
  totalCost: number;
}
```

## 5. 计费计算

### 5.1 公式

对于每个匹配配置模型的步骤：

```
inputCost = (inputTokens - cacheRead - cacheWrite) * inputPrice / 1,000,000
outputCost = outputTokens * outputPrice / 1,000,000
cacheCost = (cacheRead * cacheReadPrice + cacheWrite * cacheWritePrice) / 1,000,000
stepCost = inputCost + outputCost + cacheCost
```

### 5.2 摘要显示格式

启��计费且模型匹配时：

```markdown
- **Cost**: $0.0123 (input: $0.005, output: $0.007, cache: $0.0003)
```

## 6. 配置文件示例

启用计费的完整示例：

```json
{
  "outputPath": ".opencode/prompts",
  "filePrefix": "opencode-prompt-",
  "billing": {
    "enabled": true,
    "models": [
      {
        "model": "opencode/hy3-preview-free",
        "input": 0.0,
        "output": 0.0,
        "cacheRead": 0.0,
        "cacheWrite": 0.0
      },
      {
        "model": "opencode/sonnet-4",
        "input": 3.75,
        "output": 15.00,
        "cacheRead": 0.30,
        "cacheWrite": 3.75
      }
    ]
  }
}
```

## 7. 数据流

```
项目根目录
     │
     ├── 加载 config.ts ──→ 与默认值合并 ──→ 配置对象
     │
     ▼
index.ts
     │
     ├── 传递 outputPath + filePrefix 给 file-writer
     │
     └── 在 session.idle 时:
           ├── 查找匹配的模型配置
           ├── billing.ts 计算成本
           ├── 将成本添加到 LogData
           └── 写入带成本行的摘要
```

## 8. 验收标准

1. **零配置兼容性**: 插件无配置文件时使用所有默认值工作
2. **部分配置支持**: 仅包含部分字段的配置文件正确工作
3. **计费开关**: `billing.enabled: false` 不产生成本行
4. **模型匹配**: 仅配置的模型显示成本
5. **准确计算**: 成本与第 5.1 节公式一致
6. **可读输出**: 成本格式清晰且与现有风格一致

## 9. 向后兼容性

- 配置文件不存在时保留现有行为
- 文件路径和前缀默认保持不变
- 不更改现有日志格式，仅添加可选成本行