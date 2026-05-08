# Configuration and Billing Feature Design

**Date**: 2026-05-08
**Author**: Sisyphus
**Status**: Approved

## 1. Overview

Add a configuration module and billing calculation feature to the OpenCode Prompt Recorder plugin.

- **Configuration file**: `opencode-prompt-tracker.config.json` in project root
- **Configuration items**: output path, file prefix, billing settings
- **Billing feature**: calculate and display cost in summary when billing is enabled

## 2. Configuration Design

### 2.1 File Location

**Path**: `<project>/opencode-prompt-tracker.config.json`

Rationale: Separate from OpenCode's `opencode.json`, clearly scoped to this plugin only.

### 2.2 Configuration Schema

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

### 2.3 Field Descriptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `outputPath` | `string` | `.opencode/prompts` | Relative path from project root to output directory |
| `filePrefix` | `string` | `opencode-prompt-` | Prefix for generated markdown file names |
| `billing.enabled` | `boolean` | `false` | Master switch for billing feature |
| `billing.models` | `array` | `[]` | List of model pricing configurations |

### 2.4 Model Pricing Configuration

```json
{
  "model": "opencode/hy3-preview-free",
  "input": 0.0,
  "output": 0.0,
  "cacheRead": 0.0,
  "cacheWrite": 0.0
}
```

| Field | Unit | Description |
|-------|------|-------------|
| `model` | - | Full model name, must match the `model` field in markdown |
| `input` | $/1M tokens | Price per million input tokens (uncached) |
| `output` | $/1M tokens | Price per million output tokens |
| `cacheRead` | $/1M tokens | Price per million cache hit read tokens |
| `cacheWrite` | $/1M tokens | Price per million cache hit write tokens |

### 2.5 Zero-Config Behavior

**Rule**: If config file does not exist or a config field is missing, use defaults.

| Scenario | Behavior |
|----------|----------|
| Config file missing | Use all defaults |
| `outputPath` missing | Use `.opencode/prompts` |
| `filePrefix` missing | Use `opencode-prompt-` |
| `billing` section missing | Billing disabled |
| Model not in config | No cost calculated for that model |

## 3. Module Design

### 3.1 New Files

| File | Purpose |
|------|---------|
| `src/utils/config.ts` | Config file loading, defaults merging, validation |
| `src/utils/billing.ts` | Cost calculation logic |

### 3.2 Modified Files

| File | Changes |
|------|---------|
| `src/types.ts` | Add config-related interfaces |
| `src/index.ts` | Load config, pass to file-writer, calculate billing in summary |
| `src/utils/file-writer.ts` | Accept config for outputPath and filePrefix |

## 4. Type Definitions

```typescript
// Configuration interface
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

// Cost breakdown for a step
export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheCost: number;
  totalCost: number;
}
```

## 5. Billing Calculation

### 5.1 Formula

For each step matching a configured model:

```
inputCost = (inputTokens - cacheRead - cacheWrite) * inputPrice / 1,000,000
outputCost = outputTokens * outputPrice / 1,000,000
cacheCost = (cacheRead * cacheReadPrice + cacheWrite * cacheWritePrice) / 1,000,000
stepCost = inputCost + outputCost + cacheCost
```

### 5.2 Summary Display Format

When billing is enabled and model matches:

```markdown
- **Cost**: $0.0123 (input: $0.005, output: $0.007, cache: $0.0003)
```

## 6. Configuration File Example

Full example with billing enabled:

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

## 7. Data Flow

```
Project Root
    │
    ├── Load config.ts ──→ Merge with defaults ──→ Config object
    │
    ▼
index.ts
    │
    ├── Pass outputPath + filePrefix to file-writer
    │
    └── On session.idle:
          ├── Find matching model config
          ├── billing.ts calculates cost
          ├── Add cost to LogData
          └── Write summary with cost line
```

## 8. Acceptance Criteria

1. **Zero-config compatibility**: Plugin works without config file using all defaults
2. **Partial config support**: Config file with only some fields works correctly
3. **Billing toggle**: `billing.enabled: false` produces no cost lines
4. **Model matching**: Only configured models show costs
5. **Accurate calculation**: Costs match formula in section 5.1
6. **Readable output**: Cost format is clear and consistent with existing style

## 9. Backward Compatibility

- Existing behavior preserved when config file is absent
- File paths and prefixes remain unchanged by default
- No changes to existing log format, only addition of optional cost line