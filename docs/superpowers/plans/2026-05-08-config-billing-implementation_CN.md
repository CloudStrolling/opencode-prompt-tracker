# 配置和计费功能实现计划

**日期**: 2026-05-08
**作者**: Sisyphus
**规格**: `docs/superpowers/specs/2026-05-08-config-billing-design.md`

---

> **对于 agentic workers:** 必需的子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 添加配置模块用于输出路径/前缀，以及用于在摘要中显示成本的计费计算功能。

**架构：**
- 新增 `src/utils/config.ts` 用于加载带默认值的配置文件
- 新增 `src/utils/billing.ts` 用于成本计算逻辑
- 修改 `src/types.ts` 添加配置接口
- 修改 `src/index.ts` 加载配置并计算计费
- 修改 `src/utils/file-writer.ts` 使用可配置路径/前缀

**技术栈：** TypeScript、Node.js/Bun 文件系统 API

---

## 文件变更概览

| 文件 | 变更 |
|------|---------|
| `src/types.ts` | 添加配置接口 |
| `src/utils/config.ts` | **创建** - 带默认值的配置加载器 |
| `src/utils/billing.ts` | **创建** - 计费计算 |
| `src/index.ts` | 加载配置，传递给 file-writer，计算成本 |
| `src/utils/file-writer.ts` | 接受配置以获取路径/前缀 |
| `tests/config.test.ts` | **创建** - 配置加载测试 |
| `tests/billing.test.ts` | **创建** - 计费计算测试 |

---

## 任务 1：在 types.ts 中添加配置接口

**文件：**
- 修改: `src/types.ts`

**步骤：**

- [ ] **步骤 1：在 types.ts 末尾添加配置接口**

在最后一个右大括号前添加：

```typescript
/**
 * 计费配置 - 每百万 Token 的价格
 */
export interface BillingModelConfig {
  /** 完整模型名称，必须与 markdown 中的 model 字段匹配 */
  model: string;
  /** 每百万输入 Token（未缓存）的价格 */
  input: number;
  /** 每百万输出 Token 的价格 */
  output: number;
  /** 每百万缓存命中读取 Token 的价格 */
  cacheRead: number;
  /** 每百万缓存命中写入 Token 的价格 */
  cacheWrite: number;
}

/**
 * 计费配置部分
 */
export interface BillingConfig {
  /** 计费功能的主开关 */
  enabled: boolean;
  /** 模型定价配置列表 */
  models: BillingModelConfig[];
}

/**
 * 提示词录制插件的主配置
 */
export interface PromptRecorderConfig {
  /** 从项目根目录到输出目录的相对路径 */
  outputPath: string;
  /** 生成的 markdown 文件名的前缀 */
  filePrefix: string;
  /** 计费配置 */
  billing: BillingConfig;
}

/**
 * 步骤或会话的成本明细
 */
export interface CostBreakdown {
  /** 未缓存输入 Token 的成本 */
  inputCost: number;
  /** 输出 Token 的成本 */
  outputCost: number;
  /** 缓存 Token 的成本（读取 + 写入） */
  cacheCost: number;
  /** 总成本 */
  totalCost: number;
}

/**
 * 带有可选成本信息的日志数据
 */
export interface LogData {
  /** 唯一会话标识符 */
  sessionID: string;
  /** 对话开始时的格式化时间字符串（HH:MM:SS） */
  time: string;
  /** 箭头分隔的 Agent 调用链（例如 'oracle → build → explore'） */
  agentChain: string;
  /** 此对话使用的 AI 模型标识符 */
  model: string;
  /** 用户原始提示词文本 */
  prompt: string;
  /** 对话处理耗时（秒，保留 2 位小数） */
  duration: string;
  /** 此会话中完成的步骤数 */
  steps: number;
  /** 所有步骤的总 Token = totalInput + totalOutput */
  totalTokens: number;
  /** 消耗的输入 Token 数量（包括缓存部分） */
  inputTokens: number;
  /** 生成的输出 Token 数量 */
  outputTokens: number;
  /** 缓存 Token 总数 = totalCacheRead + totalCacheWrite（输入 Token 的子集） */
  cachedTokens: number;
  /** 未缓存 Token 总数 = inputTokens - cachedTokens */
  uncachedTokens: number;
  /** 从缓存读取的 Token 数量 */
  cacheRead: number;
  /** 写入缓存的 Token 数量 */
  cacheWrite: number;
  /** 可选的成本明细（计费启用且模型匹配时存在） */
  costBreakdown?: CostBreakdown;
}
```

---

## 任务 2：创建 config.ts - 配置加载器

**文件：**
- 创建: `src/utils/config.ts`

**步骤：**

- [ ] **步骤 1：编写带默认值和 JSON 加载的 config.ts**

```typescript
/**
 * 配置加载器工具
 * 处理从项目根目录加载配置文件，缺失字段使用默认值
 */

import type { PromptRecorderConfig } from '../types';
import { logInfo, logError } from './logger';

/** 默认配置值 */
const DEFAULT_CONFIG: PromptRecorderConfig = {
  outputPath: '.opencode/prompts',
  filePrefix: 'opencode-prompt-',
  billing: {
    enabled: false,
    models: [],
  },
};

/**
 * 项目根目录中的配置文件名
 */
export const CONFIG_FILE_NAME = 'opencode-prompt-tracker.config.json';

/**
 * 从项目根目录加载配置
 * 缺失字段或配置文件不存在时返回默认值
 */
export async function loadConfig(directory: string): Promise<PromptRecorderConfig> {
  const configPath = `${directory}/${CONFIG_FILE_NAME}`;

  try {
    let rawConfig: Partial<PromptRecorderConfig> = {};

    if (typeof Bun !== 'undefined') {
      const file = Bun.file(configPath);
      if (await file.exists()) {
        const content = await file.text();
        rawConfig = JSON.parse(content);
      }
    } else {
      const fs = await import('fs');
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        rawConfig = JSON.parse(content);
      }
    }

    // 与默认值合并
    const config: PromptRecorderConfig = {
      outputPath: rawConfig.outputPath ?? DEFAULT_CONFIG.outputPath,
      filePrefix: rawConfig.filePrefix ?? DEFAULT_CONFIG.filePrefix,
      billing: {
        enabled: rawConfig.billing?.enabled ?? DEFAULT_CONFIG.billing.enabled,
        models: rawConfig.billing?.models ?? DEFAULT_CONFIG.billing.models,
      },
    };

    await logInfo('Config loaded', {
      outputPath: config.outputPath,
      filePrefix: config.filePrefix,
      billingEnabled: config.billing.enabled,
      modelCount: config.billing.models.length,
    });

    return config;
  } catch (error) {
    await logError('Failed to load config, using defaults', {
      error: String(error),
    });
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 获取默认配置（用于测试或不需要加载配置时）
 */
export function getDefaultConfig(): PromptRecorderConfig {
  return { ...DEFAULT_CONFIG };
}
```

---

## 任务 3：创建 billing.ts - 成本计算

**文件：**
- 创建: `src/utils/billing.ts`

**步骤：**

- [ ] **步骤 1：编写带成本计算的 billing.ts**

```typescript
/**
 * 计费工具
 * 根据配置的模型定价计算 Token 成本
 */

import type { BillingModelConfig, CostBreakdown, LogData } from '../types';

/**
 * 计算步骤的成本明细
 */
export function calculateStepCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheRead: number,
  cacheWrite: number,
  pricing: BillingModelConfig | null
): CostBreakdown | null {
  if (!pricing) return null;

  const inputUncached = Math.max(0, inputTokens - cacheRead - cacheWrite);

  // 以美元计算成本
  const inputCost = (inputUncached / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheReadCost = (cacheRead / 1_000_000) * pricing.cacheRead;
  const cacheWriteCost = (cacheWrite / 1_000_000) * pricing.cacheWrite;
  const cacheCost = cacheReadCost + cacheWriteCost;
  const totalCost = inputCost + outputCost + cacheCost;

  return {
    inputCost: round4(inputCost),
    outputCost: round4(outputCost),
    cacheCost: round4(cacheCost),
    totalCost: round4(totalCost),
  };
}

/**
 * 格式化成本明细以在 markdown 中显示
 */
export function formatCostLine(cost: CostBreakdown): string {
  const total = cost.totalCost.toFixed(4);
  const input = cost.inputCost.toFixed(4);
  const output = cost.outputCost.toFixed(4);
  const cache = cost.cacheCost.toFixed(4);

  return `**Cost**: $${total} (input: $${input}, output: $${output}, cache: $${cache})`;
}

/**
 * 查找给定模型的定价配置
 */
export function findModelPricing(
  model: string,
  models: BillingModelConfig[]
): BillingModelConfig | null {
  return models.find((m) => m.model === model) || null;
}

/**
 * 四舍五入到 4 位小数
 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
```

---

## 任务 4：修改 file-writer.ts 以接受配置

**文件：**
- 修改: `src/utils/file-writer.ts:88-97`

**步骤：**

- [ ] **步骤 1：更新 buildFilePath 以接受配置参数**

替换 `buildFilePath` 函数：

```typescript
/**
 * 为会话日志文件构建文件路径
 * 使用配置值作为 outputPath 和 filePrefix
 */
function buildFilePath(
  directory: string,
  sessionID: string,
  dateStr: string,
  outputPath: string,
  filePrefix: string
): {
  fileName: string;
  filePath: string;
  promptsDir: string;
} {
  const fileName = `${filePrefix}${dateStr}_${sessionID}.md`;
  const promptsDir = `${directory}/${outputPath}`;
  const filePath = `${promptsDir}/${fileName}`;
  return { fileName, filePath, promptsDir };
}
```

- [ ] **步骤 2：更新 appendStepToPromptRecorder 签名**

替换函数签名和前三行：

```typescript
export async function appendStepToPromptRecorder(
  directory: string,
  sessionID: string,
  sessionStartTime: string,
  step: MessageStep,
  isFirstStep: boolean,
  prompt: string,
  outputPath: string,
  filePrefix: string
): Promise<void> {
  const dateStr = sessionStartTime.substring(0, 10);
  const { fileName, filePath, promptsDir } = buildFilePath(
    directory,
    sessionID,
    dateStr,
    outputPath,
    filePrefix
  );
```

- [ ] **步骤 3：更新 appendToPromptRecorder 签名**

替换函数签名和前三行：

```typescript
export async function appendToPromptRecorder(
  directory: string,
  data: LogData,
  sessionState: SessionState,
  outputPath: string,
  filePrefix: string
): Promise<void> {
  const dateStr = sessionState.sessionStartTime.substring(0, 10);
  const { fileName, filePath, promptsDir } = buildFilePath(
    directory,
    data.sessionID,
    dateStr,
    outputPath,
    filePrefix
  );
```

---

## 任务 5：修改 index.ts - 集成配置和计费

**文件：**
- 修改: `src/index.ts`

**步骤：**

- [ ] **步骤 1：添加 config 和 billing 工具的导入**

在现有导入后添加：

```typescript
import { loadConfig } from './utils/config';
import type { PromptRecorderConfig } from './types';
import {
  findModelPricing,
  calculateStepCost,
  formatCostLine,
} from './utils/billing';
```

- [ ] **步骤 2：在插件工厂中添加配置变量和加载配置**

替换 PromptRecorderPlugin 开头部分：

```typescript
export const PromptRecorderPlugin = async ({
  client,
  directory,
}: {
  client: any;
  directory: string;
}) => {
  const sessionStates = new Map<string, SessionState>();
  let config: PromptRecorderConfig = await loadConfig(directory);

  initLogger(client, directory);
  await logInfo('Plugin initialized');
```

- [ ] **步骤 3：在 writeLogAndCleanup 中添加成本计算**

在 `logData` ���建���，`appendToPromptRecorder` 调用前添加成本计算：

```typescript
    // 如果启用计费则计算成本
    if (config.billing.enabled) {
      const modelPricing = findModelPricing(
        logData.model,
        config.billing.models
      );
      if (modelPricing) {
        logData.costBreakdown = calculateStepCost(
          logData.model,
          logData.inputTokens,
          logData.outputTokens,
          logData.cacheRead,
          logData.cacheWrite,
          modelPricing
        );
      }
    }
```

- [ ] **步骤 4：传递配置给 appendStepToPromptRecorder**

找到 `appendStepToPromptRecorder` 调用并添加配置参数：

替换：
```typescript
await appendStepToPromptRecorder(
  directory,
  sessionID,
  state.sessionStartTime,
  step,
  isFirstStep,
  state.prompt
);
```

为：
```typescript
await appendStepToPromptRecorder(
  directory,
  sessionID,
  state.sessionStartTime,
  step,
  isFirstStep,
  state.prompt,
  config.outputPath,
  config.filePrefix
);
```

- [ ] **步骤 5：传递配置给 appendToPromptRecorder**

替换 `appendToPromptRecorder` 调用：
```typescript
await appendToPromptRecorder(directory, logData, state);
```

为：
```typescript
await appendToPromptRecorder(
  directory,
  logData,
  state,
  config.outputPath,
  config.filePrefix
);
```

---

## 任务 6：更新 file-writer.ts - 在摘要中格式化成本

**文件：**
- 修改: `src/utils/file-writer.ts`

**步骤：**

- [ ] **步骤 1：更新 formatSummaryEntry 包含成本行**

替换 `formatSummaryEntry` 函数：

```typescript
/**
 * 将摘要条目格式化为 Markdown 格式
 * 在 session.idle 触发后、所有步骤日志之后写入
 */
function formatSummaryEntry(data: LogData): string {
  let costLine = '';
  if (data.costBreakdown) {
    costLine = `\n- ${formatCostLine(data.costBreakdown)}`;
  }

  return `---

## Summary — ${data.time}
- **Model**: ${data.model}
- **Agent Chain**: ${data.agentChain}
- **Total Duration**: ${data.duration}s
- **Steps**: ${data.steps}
- **Total Tokens**: ${data.totalTokens} (input: ${data.inputTokens}, output: ${data.outputTokens})
- **Cached Tokens**: ${data.cachedTokens} (read: ${data.cacheRead}, write: ${data.cacheWrite})
- **Uncached Tokens**: ${data.uncachedTokens}${costLine}

---

`;
}
```

---

## 任务 7：编写配置模块测试

**文件：**
- 创建: `tests/config.test.ts`

**步骤：**

- [ ] **步骤 1：编写配置测试**

```typescript
import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { loadConfig, getDefaultConfig, CONFIG_FILE_NAME } from '../src/utils/config';

const TEST_DIR = '/tmp/config-test';

function setup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

describe('loadConfig', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('配置文件不存在时返回默认值', async () => {
    const config = await loadConfig(TEST_DIR);
    expect(config.outputPath).toBe('.opencode/prompts');
    expect(config.filePrefix).toBe('opencode-prompt-');
    expect(config.billing.enabled).toBe(false);
    expect(config.billing.models).toEqual([]);
  });

  test('加载自定义 outputPath 和 filePrefix', async () => {
    const configContent = {
      outputPath: 'custom/prompts',
      filePrefix: 'my-prefix-',
    };
    writeFileSync(
      join(TEST_DIR, CONFIG_FILE_NAME),
      JSON.stringify(configContent)
    );

    const config = await loadConfig(TEST_DIR);
    expect(config.outputPath).toBe('custom/prompts');
    expect(config.filePrefix).toBe('my-prefix-');
    expect(config.billing.enabled).toBe(false); // 默认值
  });

  test('加载计费配置', async () => {
    const configContent = {
      billing: {
        enabled: true,
        models: [
          {
            model: 'test/model',
            input: 1.0,
            output: 2.0,
            cacheRead: 0.1,
            cacheWrite: 0.5,
          },
        ],
      },
    };
    writeFileSync(
      join(TEST_DIR, CONFIG_FILE_NAME),
      JSON.stringify(configContent)
    );

    const config = await loadConfig(TEST_DIR);
    expect(config.billing.enabled).toBe(true);
    expect(config.billing.models.length).toBe(1);
    expect(config.billing.models[0].model).toBe('test/model');
    expect(config.billing.models[0].input).toBe(1.0);
  });

  test('部分配置对缺失字段使用默认值', async () => {
    const configContent = {
      outputPath: 'custom/path',
      // filePrefix 缺失，billing 缺失
    };
    writeFileSync(
      join(TEST_DIR, CONFIG_FILE_NAME),
      JSON.stringify(configContent)
    );

    const config = await loadConfig(TEST_DIR);
    expect(config.outputPath).toBe('custom/path');
    expect(config.filePrefix).toBe('opencode-prompt-'); // 默认值
    expect(config.billing.enabled).toBe(false); // 默认值
  });
});

describe('getDefaultConfig', () => {
  test('返回默认配置', () => {
    const config = getDefaultConfig();
    expect(config.outputPath).toBe('.opencode/prompts');
    expect(config.filePrefix).toBe('opencode-prompt-');
    expect(config.billing.enabled).toBe(false);
    expect(config.billing.models).toEqual([]);
  });

  test('修改返回的配置不影响默认值', () => {
    const config = getDefaultConfig();
    config.outputPath = 'modified';
    const config2 = getDefaultConfig();
    expect(config2.outputPath).toBe('.opencode/prompts');
  });
});
```

---

## 任务 8：编写计费模块测试

**文件：**
- 创建: `tests/billing.test.ts`

**步骤：**

- [ ] **步骤 1：编写计费测试**

```typescript
import { describe, expect, test } from 'bun:test';
import {
  calculateStepCost,
  findModelPricing,
  formatCostLine,
} from '../src/utils/billing';
import type { BillingModelConfig } from '../src/types';

const testPricing: BillingModelConfig = {
  model: 'test/model',
  input: 1.0,      // 每百万 Token $1
  output: 2.0,     // 每百万 Token $2
  cacheRead: 0.1,   // 每百万 Token $0.1
  cacheWrite: 0.5,  // 每百万 Token $0.5
};

describe('calculateStepCost', () => {
  test('定价为 null 时返回 null', () => {
    const result = calculateStepCost('test/model', 1000, 500, 0, 0, null);
    expect(result).toBeNull();
  });

  test('正确计算输入成本（未缓存）', () => {
    // 1000 输入 Token，每百万 $1 = $0.001
    const result = calculateStepCost('test/model', 1000, 500, 0, 0, testPricing);
    expect(result?.inputCost).toBe(0.001);
  });

  test('正确计算输出成本', () => {
    // 500 输出 Token，每百万 $2 = $0.001
    const result = calculateStepCost('test/model', 1000, 500, 0, 0, testPricing);
    expect(result?.outputCost).toBe(0.001);
  });

  test('正确计算缓存成本', () => {
    // 100 cacheRead，每百万 $0.1 = $0.00001
    // 50 cacheWrite，每百万 $0.5 = $0.000025
    const result = calculateStepCost('test/model', 1000, 500, 100, 50, testPricing);
    expect(result?.cacheCost).toBe(0.000035);
  });

  test('输入成本使用未缓存 Token（input - cache）', () => {
    // 1000 输入，200 缓存 = 800 未缓存
    // 800 未缓存，每百万 $1 = $0.0008
    const result = calculateStepCost('test/model', 1000, 500, 100, 100, testPricing);
    expect(result?.inputCost).toBe(0.0008);
  });

  test('正确计算总成本', () => {
    // input: $0.0008 (800 未缓存)
    // output: $0.001 (500 Token)
    // cache: $0.00006 (100 * 0.1 + 50 * 0.5)
    // total: $0.00186
    const result = calculateStepCost('test/model', 1000, 500, 100, 50, testPricing);
    expect(result?.totalCost).toBe(0.00186);
  });

  test('处理零 Token', () => {
    const result = calculateStepCost('test/model', 0, 0, 0, 0, testPricing);
    expect(result?.totalCost).toBe(0);
  });

  test('处理零定价', () => {
    const freePricing: BillingModelConfig = {
      model: 'free/model',
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
    const result = calculateStepCost('test/model', 1000000, 1000000, 500000, 500000, freePricing);
    expect(result?.totalCost).toBe(0);
  });
});

describe('findModelPricing', () => {
  const models: BillingModelConfig[] = [
    { model: 'a/model', input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 },
    { model: 'b/model', input: 3, output: 4, cacheRead: 0.2, cacheWrite: 0.6 },
  ];

  test('找到匹配的模型', () => {
    const result = findModelPricing('a/model', models);
    expect(result?.input).toBe(1);
  });

  test('模型未找到时返回 null', () => {
    const result = findModelPricing('c/model', models);
    expect(result).toBeNull();
  });
});

describe('formatCostLine', () => {
  test('正确格式化成本行', () => {
    const cost = {
      inputCost: 0.001,
      outputCost: 0.002,
      cacheCost: 0.0003,
      totalCost: 0.0033,
    };
    const result = formatCostLine(cost);
    expect(result).toBe(
      '**Cost**: $0.0033 (input: $0.0010, output: $0.0020, cache: $0.0003)'
    );
  });

  test('正确格式化零成本', () => {
    const cost = {
      inputCost: 0,
      outputCost: 0,
      cacheCost: 0,
      totalCost: 0,
    };
    const result = formatCostLine(cost);
    expect(result).toBe(
      '**Cost**: $0.0000 (input: $0.0000, output: $0.0000, cache: $0.0000)'
    );
  });
});
```

---

## 任务 9：构建和测试

**步骤：**

- [ ] **步骤 1：运行构建**

运行：`npm run build`

- [ ] **步骤 2：运行测试**

运行：`npm test`

- [ ] **步骤 3：验证诊断**

在变更的文件上运行：`lsp_diagnostics`

---

## 任务 10：创建示例配置文件

**文件：**
- 创建: `opencode-prompt-tracker.config.example.json`

**步骤：**

- [ ] **步骤 1：创建示例配置文件**

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
        "output": 15.0,
        "cacheRead": 0.3,
        "cacheWrite": 3.75
      }
    ]
  }
}
```

---

## 任务 11：更新 README

**文件：**
- 修改: `README.md` 和 `README_CN.md`

**步骤：**

- [ ] **步骤 1：在 README.md 中添加配置部分**

在安装部分后添加：

```markdown
## Configuration

Create `opencode-prompt-tracker.config.json` in your project root:

```json
{
  "outputPath": ".opencode/prompts",
  "filePrefix": "opencode-prompt-",
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

| Field | Default | Description |
|-------|---------|-------------|
| `outputPath` | `.opencode/prompts` | Output directory relative to project root |
| `filePrefix` | `opencode-prompt-` | File name prefix |
| `billing.enabled` | `false` | Enable cost calculation |
| `billing.models` | `[]` | Model pricing config |

When billing is enabled and the model is configured, the summary includes a cost line:
```markdown
- **Cost**: $0.0123 (input: $0.005, output: $0.007, cache: $0.0003)
```

Without a config file, the plugin uses all defaults and works as before.
```

---

## 任务 12：提交变更

**步骤：**

- [ ] **步骤 1：暂存变更**

运行：`git add -A`

- [ ] **步骤 2：提交**

运行：`git commit -m "feat: add config module and billing calculation

- add config.ts for loading opencode-prompt-tracker.config.json
- add billing.ts for cost calculation based on model pricing
- add config interfaces to types.ts
- modify index.ts to integrate config and billing
- modify file-writer.ts to use configurable path/prefix
- add tests for config and billing modules
- add example config file
- update README with configuration section"`

---

## 自审检查清单

- [ ] 所有规格需求都有任务覆盖
- [ ] 计划中无待办或占位符
- [ ] 任务间类型签名一致
- [ ] 文件路径准确
- [ ] 所有实现步骤都有代码块
- [ ] 新模块包含测试��码

---

**计划完成。**