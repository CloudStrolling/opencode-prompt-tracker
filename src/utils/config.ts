/*
 * Copyright 2026 jenemy8023<jenemy8023@163.com>
 *
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
  saveAllLogs: false,
};

/**
 * Config file name in project root
 */
export const CONFIG_FILE_NAME = 'opencode-prompt-tracker.config.json';

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
      saveAllLogs: rawConfig.saveAllLogs ?? DEFAULT_CONFIG.saveAllLogs,
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