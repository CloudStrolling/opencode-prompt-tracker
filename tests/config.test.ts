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
    writeFileSync(join(TEST_DIR, CONFIG_FILE_NAME), JSON.stringify(configContent));

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
    writeFileSync(join(TEST_DIR, CONFIG_FILE_NAME), JSON.stringify(configContent));

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
    writeFileSync(join(TEST_DIR, CONFIG_FILE_NAME), JSON.stringify(configContent));

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

describe('CONFIG_FILE_NAME', () => {
  test('has correct file name', () => {
    expect(CONFIG_FILE_NAME).toBe('opencode-prompt-tracker.config.json');
  });
});