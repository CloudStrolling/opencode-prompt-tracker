# Configuration and Billing Feature Implementation Plan

**Date**: 2026-05-08
**Author**: Sisyphus
**Spec**: `docs/superpowers/specs/2026-05-08-config-billing-design.md`

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configuration module for output path/prefix and billing calculation feature for cost display in summary.

**Architecture:**
- New `src/utils/config.ts` for loading config file with defaults
- New `src/utils/billing.ts` for cost calculation logic
- Modify `src/types.ts` to add config interfaces
- Modify `src/index.ts` to load config and calculate billing
- Modify `src/utils/file-writer.ts` to use configurable path/prefix

**Tech Stack:** TypeScript, Node.js/Bun file system APIs

---

## File Changes Overview

| File | Changes |
|------|---------|
| `src/types.ts` | Add config interfaces |
| `src/utils/config.ts` | **CREATE** - Config loader with defaults |
| `src/utils/billing.ts` | **CREATE** - Billing calculation |
| `src/index.ts` | Load config, pass to file-writer, calculate cost |
| `src/utils/file-writer.ts` | Accept config for path/prefix |
| `tests/config.test.ts` | **CREATE** - Config loading tests |
| `tests/billing.test.ts` | **CREATE** - Billing calculation tests |

---

## Task 1: Add Config Interfaces to types.ts

**Files:**
- Modify: `src/types.ts`

**Steps:**

- [ ] **Step 1: Add config interfaces at end of types.ts**

Add before the last closing brace:

```typescript
/**
 * Configuration for billing - price per million tokens
 */
export interface BillingModelConfig {
  /** Full model name, must match the model field in markdown */
  model: string;
  /** Price per million input tokens (uncached) */
  input: number;
  /** Price per million output tokens */
  output: number;
  /** Price per million cache hit read tokens */
  cacheRead: number;
  /** Price per million cache hit write tokens */
  cacheWrite: number;
}

/**
 * Billing configuration section
 */
export interface BillingConfig {
  /** Master switch for billing feature */
  enabled: boolean;
  /** List of model pricing configurations */
  models: BillingModelConfig[];
}

/**
 * Main configuration for prompt recorder plugin
 */
export interface PromptRecorderConfig {
  /** Relative path from project root to output directory */
  outputPath: string;
  /** Prefix for generated markdown file names */
  filePrefix: string;
  /** Billing configuration */
  billing: BillingConfig;
}

/**
 * Cost breakdown for a step or session
 */
export interface CostBreakdown {
  /** Cost for uncached input tokens */
  inputCost: number;
  /** Cost for output tokens */
  outputCost: number;
  /** Cost for cached tokens (read + write) */
  cacheCost: number;
  /** Total cost */
  totalCost: number;
}

/**
 * Log data with optional cost info
 */
export interface LogData {
  /** Unique session identifier */
  sessionID: string;
  /** Formatted time string (HH:MM:SS) when conversation started */
  time: string;
  /** Agent call chain as arrow-separated string (e.g., 'oracle → build → explore') */
  agentChain: string;
  /** AI model identifier used for this conversation */
  model: string;
  /** User's original prompt text */
  prompt: string;
  /** Duration of conversation processing in seconds (fixed to 2 decimal places) */
  duration: string;
  /** Number of completed steps in this session */
  steps: number;
  /** Total tokens across all steps = totalInput + totalOutput */
  totalTokens: number;
  /** Number of input tokens consumed (includes cached portions) */
  inputTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
  /** Total cached tokens = totalCacheRead + totalCacheWrite (subset of inputTokens) */
  cachedTokens: number;
  /** Total uncached tokens = inputTokens - cachedTokens */
  uncachedTokens: number;
  /** Number of tokens read from cache */
  cacheRead: number;
  /** Number of tokens written to cache */
  cacheWrite: number;
  /** Optional cost breakdown (present when billing enabled and model matched) */
  costBreakdown?: CostBreakdown;
}
```

---

## Task 2: Create config.ts - Configuration Loader

**Files:**
- Create: `src/utils/config.ts`

**Steps:**

- [ ] **Step 1: Write config.ts with defaults and JSON loading**

```typescript
/**
 * Configuration Loader Utility
 * Handles loading config file from project root with defaults for missing fields
 */

import type { PromptRecorderConfig } from '../types';
import { logInfo, logError } from './logger';

/** Default configuration values */
const DEFAULT_CONFIG: PromptRecorderConfig = {
  outputPath: '.opencode/prompts',
  filePrefix: 'opencode-prompt-',
  billing: {
    enabled: false,
    models: [],
  },
};

/**
 * Config file name in project root
 */
export const CONFIG_FILE_NAME = 'opencode-prompt-recorder.config.json';

/**
 * Loads configuration from project root
 * Returns default values for any missing fields or missing config file
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

    // Merge with defaults
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
 * Gets default configuration (for testing or when config loading is not needed)
 */
export function getDefaultConfig(): PromptRecorderConfig {
  return { ...DEFAULT_CONFIG };
}
```

---

## Task 3: Create billing.ts - Cost Calculation

**Files:**
- Create: `src/utils/billing.ts`

**Steps:**

- [ ] **Step 1: Write billing.ts with cost calculation**

```typescript
/**
 * Billing Utility
 * Calculates token costs based on configured model pricing
 */

import type { BillingModelConfig, CostBreakdown, LogData } from '../types';

/**
 * Calculates cost breakdown for a step
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

  // Calculate costs in dollars
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
 * Formats cost breakdown for display in markdown
 */
export function formatCostLine(cost: CostBreakdown): string {
  const total = cost.totalCost.toFixed(4);
  const input = cost.inputCost.toFixed(4);
  const output = cost.outputCost.toFixed(4);
  const cache = cost.cacheCost.toFixed(4);

  return `**Cost**: $${total} (input: $${input}, output: $${output}, cache: $${cache})`;
}

/**
 * Finds pricing config for a given model
 */
export function findModelPricing(
  model: string,
  models: BillingModelConfig[]
): BillingModelConfig | null {
  return models.find((m) => m.model === model) || null;
}

/**
 * Rounds to 4 decimal places
 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
```

---

## Task 4: Modify file-writer.ts to Accept Config

**Files:**
- Modify: `src/utils/file-writer.ts:88-97`

**Steps:**

- [ ] **Step 1: Update buildFilePath to accept config parameters**

Replace the `buildFilePath` function:

```typescript
/**
 * Builds the file path for a session's log file
 * Uses config values for outputPath and filePrefix
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

- [ ] **Step 2: Update appendStepToPromptRecorder signature**

Replace function signature and first lines:

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

- [ ] **Step 3: Update appendToPromptRecorder signature**

Replace function signature and first lines:

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

## Task 5: Modify index.ts - Integrate Config and Billing

**Files:**
- Modify: `src/index.ts`

**Steps:**

- [ ] **Step 1: Add imports for config and billing utilities**

Add after existing imports:

```typescript
import { loadConfig } from './utils/config';
import type { PromptRecorderConfig } from './types';
import {
  findModelPricing,
  calculateStepCost,
  formatCostLine,
} from './utils/billing';
```

- [ ] **Step 2: Add config variable and load config in plugin factory**

Replace the beginning of PromptRecorderPlugin:

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

- [ ] **Step 3: Add cost calculation in writeLogAndCleanup**

Find the `logData` creation in `writeLogAndCleanup` and add cost calculation:

After:
```typescript
    const logData: LogData = {
      sessionID,
      time,
      agentChain: state.agentChain.join(' → ') || 'unknown',
      model: state.lastModel || state.model || 'unknown',
      prompt: state.prompt,
      duration: durationSec,
      steps: state.stepCount,
      totalTokens: state.totalInputTokens + state.totalOutputTokens,
      inputTokens: state.totalInputTokens,
      outputTokens: state.totalOutputTokens,
      cachedTokens: totalCached,
      uncachedTokens: totalUncached,
      cacheRead: state.totalCacheRead,
      cacheWrite: state.totalCacheWrite,
    };
```

Add before the `appendToPromptRecorder` call:

```typescript
    // Calculate billing if enabled
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

- [ ] **Step 4: Pass config to appendStepToPromptRecorder**

Find the call to `appendStepToPromptRecorder` and add config parameters:

Replace:
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

With:
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

- [ ] **Step 5: Pass config to appendToPromptRecorder**

Replace the `appendToPromptRecorder` call:
```typescript
await appendToPromptRecorder(directory, logData, state);
```

With:
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

## Task 6: Update file-writer.ts - Format Cost in Summary

**Files:**
- Modify: `src/utils/file-writer.ts`

**Steps:**

- [ ] **Step 1: Update formatSummaryEntry to include cost line**

Replace the `formatSummaryEntry` function:

```typescript
/**
 * Formats a summary entry into Markdown format
 * Written when session.idle fires, after all step logs
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

## Task 7: Write Tests for Config Module

**Files:**
- Create: `tests/config.test.ts`

**Steps:**

- [ ] **Step 1: Write config tests**

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

  test('returns defaults when config file does not exist', async () => {
    const config = await loadConfig(TEST_DIR);
    expect(config.outputPath).toBe('.opencode/prompts');
    expect(config.filePrefix).toBe('opencode-prompt-');
    expect(config.billing.enabled).toBe(false);
    expect(config.billing.models).toEqual([]);
  });

  test('loads custom outputPath and filePrefix', async () => {
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
    expect(config.billing.enabled).toBe(false); // default
  });

  test('loads billing config', async () => {
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

  test('partial config uses defaults for missing fields', async () => {
    const configContent = {
      outputPath: 'custom/path',
      // filePrefix missing, billing missing
    };
    writeFileSync(
      join(TEST_DIR, CONFIG_FILE_NAME),
      JSON.stringify(configContent)
    );

    const config = await loadConfig(TEST_DIR);
    expect(config.outputPath).toBe('custom/path');
    expect(config.filePrefix).toBe('opencode-prompt-'); // default
    expect(config.billing.enabled).toBe(false); // default
  });
});

describe('getDefaultConfig', () => {
  test('returns default configuration', () => {
    const config = getDefaultConfig();
    expect(config.outputPath).toBe('.opencode/prompts');
    expect(config.filePrefix).toBe('opencode-prompt-');
    expect(config.billing.enabled).toBe(false);
    expect(config.billing.models).toEqual([]);
  });

  test('modifying returned config does not affect defaults', () => {
    const config = getDefaultConfig();
    config.outputPath = 'modified';
    const config2 = getDefaultConfig();
    expect(config2.outputPath).toBe('.opencode/prompts');
  });
});
```

---

## Task 8: Write Tests for Billing Module

**Files:**
- Create: `tests/billing.test.ts`

**Steps:**

- [ ] **Step 1: Write billing tests**

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
  input: 1.0,      // $1 per 1M tokens
  output: 2.0,     // $2 per 1M tokens
  cacheRead: 0.1,  // $0.1 per 1M tokens
  cacheWrite: 0.5,  // $0.5 per 1M tokens
};

describe('calculateStepCost', () => {
  test('returns null when pricing is null', () => {
    const result = calculateStepCost('test/model', 1000, 500, 0, 0, null);
    expect(result).toBeNull();
  });

  test('calculates input cost correctly (uncached)', () => {
    // 1000 input tokens at $1/1M = $0.001
    const result = calculateStepCost('test/model', 1000, 500, 0, 0, testPricing);
    expect(result?.inputCost).toBe(0.001);
  });

  test('calculates output cost correctly', () => {
    // 500 output tokens at $2/1M = $0.001
    const result = calculateStepCost('test/model', 1000, 500, 0, 0, testPricing);
    expect(result?.outputCost).toBe(0.001);
  });

  test('calculates cache cost correctly', () => {
    // 100 cacheRead at $0.1/1M = $0.00001
    // 50 cacheWrite at $0.5/1M = $0.000025
    const result = calculateStepCost('test/model', 1000, 500, 100, 50, testPricing);
    expect(result?.cacheCost).toBe(0.000035);
  });

  test('input cost uses uncached tokens (input - cache)', () => {
    // 1000 input, 200 cache = 800 uncached
    // 800 uncached at $1/1M = $0.0008
    const result = calculateStepCost('test/model', 1000, 500, 100, 100, testPricing);
    expect(result?.inputCost).toBe(0.0008);
  });

  test('calculates total cost correctly', () => {
    // input: $0.0008 (800 uncached)
    // output: $0.001 (500 tokens)
    // cache: $0.00006 (100 * 0.1 + 50 * 0.5)
    // total: $0.00186
    const result = calculateStepCost('test/model', 1000, 500, 100, 50, testPricing);
    expect(result?.totalCost).toBe(0.00186);
  });

  test('handles zero tokens', () => {
    const result = calculateStepCost('test/model', 0, 0, 0, 0, testPricing);
    expect(result?.totalCost).toBe(0);
  });

  test('handles zero pricing', () => {
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

  test('finds matching model', () => {
    const result = findModelPricing('a/model', models);
    expect(result?.input).toBe(1);
  });

  test('returns null when model not found', () => {
    const result = findModelPricing('c/model', models);
    expect(result).toBeNull();
  });
});

describe('formatCostLine', () => {
  test('formats cost line correctly', () => {
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

  test('formats zero costs correctly', () => {
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

## Task 9: Build and Test

**Steps:**

- [ ] **Step 1: Run build**

Run: `npm run build`

- [ ] **Step 2: Run tests**

Run: `npm test`

- [ ] **Step 3: Verify diagnostics**

Run: `lsp_diagnostics` on changed files

---

## Task 10: Create Example Config File

**Files:**
- Create: `opencode-prompt-recorder.config.example.json`

**Steps:**

- [ ] **Step 1: Create example config file**

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

## Task 11: Update README

**Files:**
- Modify: `README.md` and `README_CN.md`

**Steps:**

- [ ] **Step 1: Add configuration section to README.md**

Add after Installation section:

```markdown
## Configuration

Create `opencode-prompt-recorder.config.json` in your project root:

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

## Task 12: Commit Changes

**Steps:**

- [ ] **Step 1: Stage changes**

Run: `git add -A`

- [ ] **Step 2: Commit**

Run: `git commit -m "feat: add config module and billing calculation

- add config.ts for loading opencode-prompt-recorder.config.json
- add billing.ts for cost calculation based on model pricing
- add config interfaces to types.ts
- modify index.ts to integrate config and billing
- modify file-writer.ts to use configurable path/prefix
- add tests for config and billing modules
- add example config file
- update README with configuration section"`

---

## Self-Review Checklist

- [ ] All spec requirements covered by tasks
- [ ] No TODOs or placeholders in plan
- [ ] Type signatures consistent across tasks
- [ ] File paths exact
- [ ] Code blocks for all implementation steps
- [ ] Test code included for new modules

---

**Plan complete.**