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
 * OpenCode Prompt Recorder Plugin - Main Entry Point
 *
 * This plugin records each conversation's prompt, model, agent call chain,
 * duration, and token usage to daily Markdown files.
 *
 * Hooks used:
 * - chat.message: Captures user messages when sent, records initial state
 * - event: Monitors message.part.updated for text collection,
 *   message.updated for step logging, and session.idle for summary
 *
 * Key design: In agent workflows (e.g., Sisyphus - Ultraworker), multiple
 * assistant messages may complete within a single session. Each completed
 * assistant message is logged as a "step" immediately, providing real-time
 * visibility. When the session goes idle, a summary with accumulated totals
 * is written.
 *
 * Output: <project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md
 */

import type { SessionState, LogData, MessageStep, PromptRecorderConfig, AllLogsData } from './types';
import { appendToPromptRecorder, appendStepToPromptRecorder, appendAllLogsToPromptRecorder } from './utils/file-writer';
import { extractAgentChain } from './utils/agent-extractor';
import { initLogger, logInfo, logError } from './utils/logger';
import { loadConfig } from './utils/config';
import {
  findModelPricing,
  calculateStepCost,
} from './utils/billing';

/** Maximum length for task description extracted from assistant output */
const MAX_TASK_DESC_LENGTH = 120;

/**
 * Merges two agent chain arrays, removing duplicates
 * Initial agents from input are preserved, extracted agents are added if not present
 */
function mergeAgentChains(initialAgents: string[], extractedAgents: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const agent of initialAgents) {
    if (!seen.has(agent)) {
      merged.push(agent);
      seen.add(agent);
    }
  }

  for (const agent of extractedAgents) {
    if (!seen.has(agent)) {
      merged.push(agent);
      seen.add(agent);
    }
  }

  return merged;
}

/**
 * Formats a Date object into YYYY-MM-DD string for file naming
 */
function formatDateForFileName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Extracts user prompt text from message parts array
 * Filters for text-type parts and joins multiple text blocks
 */
function extractPromptFromParts(parts: any[]): string {
  if (!parts || !Array.isArray(parts)) return '';
  return parts
    .filter((p: any) => p.type === 'text')
    .map((p: any) => p.text)
    .join('\n');
}

/**
 * Extracts model identifier from input context
 * Handles different model format options (providerID/modelID or direct string)
 */
function extractModelFromInput(input: any): string {
  if (input.model) {
    if (input.model.providerID && input.model.modelID) {
      return `${input.model.providerID}/${input.model.modelID}`;
    }
    if (typeof input.model === 'string') {
      return input.model;
    }
  }
  return 'unknown';
}

/**
 * Extracts and normalizes token counts from an assistant message
 * Handles both primary tokens structure and older usage structure
 *
 * Note: input tokens INCLUDE cached portions (cacheRead + cacheWrite).
 * uncached = input - cacheRead - cacheWrite
 */
function extractTokens(info: any): {
  input: number;
  output: number;
  context: number;
  cacheRead: number;
  cacheWrite: number;
} {
  let tokens: any = info.tokens || {};
  if (!info.tokens && info.usage) {
    tokens = {
      input: info.usage.prompt_tokens || info.usage.input_tokens,
      output: info.usage.completion_tokens || info.usage.output_tokens,
      cache: {
        read: info.usage.cache_read_input_tokens || 0,
        write: info.usage.cache_creation_input_tokens || 0,
      },
    };
  }
  return {
    input: tokens.input || 0,
    output: tokens.output || 0,
    context: tokens.context || 0,
    cacheRead: tokens.cache?.read || 0,
    cacheWrite: tokens.cache?.write || 0,
  };
}

/**
 * Extracts the agent name from an assistant message info object
 * Tries multiple fields in order of priority to get meaningful agent names
 */
function extractAgentFromInfo(info: any): string {
  // Priority 1: info.agent (direct string or object with name)
  if (info.agent) {
    if (typeof info.agent === 'string' && info.agent.trim()) {
      return info.agent.trim();
    }
    if (info.agent.name && typeof info.agent.name === 'string') {
      return info.agent.name.trim();
    }
  }

  // Priority 2: info.name (some events use this field)
  if (info.name && typeof info.name === 'string' && info.name.trim()) {
    return info.name.trim();
  }

  // Priority 3: Try to extract from agent info object
  if (info.agentInfo?.name) {
    return info.agentInfo.name;
  }

  // Priority 4: info.providerID - but filter out generic "opencode"
  if (info.providerID && typeof info.providerID === 'string') {
    const provider = info.providerID.trim().toLowerCase();
    // Skip generic provider names that aren't meaningful agent identifiers
    if (provider && provider !== 'opencode' && provider !== 'unknown') {
      return info.providerID.trim();
    }
  }

  // Priority 5: Try to get from message parts if available
  if (info.parts && Array.isArray(info.parts)) {
    for (const part of info.parts) {
      if (part.type === 'agent' && part.name) {
        return part.name;
      }
      if (part.type === 'subtask' && part.agent) {
        return part.agent;
      }
    }
  }

  // Fallback: unknown
  return 'unknown';
}

/**
 * Extracts a brief task description from accumulated message text
 * Fallback chain:
 * 1. First non-empty line from accumulated text
 * 2. Task/description fields from info metadata
 * 3. Content structure fields from info
 * 4. First line from AI response content (final fallback)
 * 5. First segment of assistant's reply content (if all above fail)
 */
function extractTaskDescription(text: string, info?: any, thinkingText?: string): string {
  // Priority 1: Try to get from accumulated text (first meaningful line)
  if (text) {
    const firstLine = text.split('\n').find((line) => line.trim().length > 0) || '';
    const cleaned = cleanTaskText(firstLine);
    if (cleaned) return cleaned;
  }

  // Priority 2: Try thinking/reasoning content as fallback (often has meaningful summary at end)
  if (thinkingText) {
    const thinkingCleaned = extractMeaningfulLineFromThinking(thinkingText);
    if (thinkingCleaned) return thinkingCleaned;
  }

  // Priority 3: Try info metadata fields
  const fromInfo = extractTaskFromInfo(info);
  if (fromInfo) return fromInfo;

  // Priority 4: Try to extract from AI response content structure
  const fromContent = extractTaskFromContent(info);
  if (fromContent) return fromContent;

  // Priority 5: Final fallback - use first line from raw text
  if (text) {
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      // Skip common non-meaningful prefixes
      const skipPrefixes = ['```', '-----', '===', '---', 'Step', 'Agent:', 'Model:'];
      const isMeaningful = !skipPrefixes.some((prefix) =>
        firstLine.toLowerCase().startsWith(prefix.toLowerCase())
      );
      if (isMeaningful) {
        return cleanTaskText(firstLine) || '';
      }
    }
  }

  // Priority 6: Use first segment of assistant's reply as task
  const fromReply = extractFirstSegmentFromReply(info);
  if (fromReply) return fromReply;

  // Priority 7: Extract from thinking content at any position
  if (thinkingText) {
    const lines = thinkingText.split('\n').filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const cleaned = cleanTaskText(line);
      if (cleaned && cleaned.length > 5 && !isGenericModelName(cleaned)) {
        const skipPrefixes = ['```', '-----', '===', '---', 'Step', 'Agent:', 'Model:'];
        const isMeaningful = !skipPrefixes.some((prefix) =>
          cleaned.toLowerCase().startsWith(prefix.toLowerCase())
        );
        if (isMeaningful) return cleaned;
      }
    }
  }

  return '';
}

/**
 * Extracts a meaningful line from thinking/reasoning content
 * Typically thinking content ends with a summary/conclusion
 */
function extractMeaningfulLineFromThinking(thinkingText: string): string {
  if (!thinkingText) return '';

  // Try last few lines of thinking content (often contains summary)
  const lines = thinkingText.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return '';

  // Check last 5 lines for a meaningful summary
  const lastLines = lines.slice(-5);
  for (const line of lastLines) {
    const cleaned = cleanTaskText(line);
    if (cleaned && cleaned.length > 5 && !isGenericModelName(cleaned)) {
      const skipPrefixes = ['```', '-----', '===', '---', 'Step', 'Agent:', 'Model:'];
      const isMeaningful = !skipPrefixes.some((prefix) =>
        cleaned.toLowerCase().startsWith(prefix.toLowerCase())
      );
      if (isMeaningful) return cleaned;
    }
  }

  return '';
}

/**
 * Extracts the first meaningful segment from assistant's reply content
 * Used when all other task extraction methods fail
 */
function extractFirstSegmentFromReply(info: any): string {
  if (!info) return '';

  // Try various paths where assistant reply content might be stored
  const contentSources = [
    // Direct content field
    info.content,
    // Message content
    info.message?.content,
    // Parts array - look for text parts
    ...(info.parts || []),
    // Message parts
    ...(info.message?.parts || []),
  ];

  for (const source of contentSources) {
    if (!source) continue;

    // Handle string content
    if (typeof source === 'string') {
      const firstLine = source.split('\n')[0]?.trim();
      if (firstLine) {
        const cleaned = cleanTaskText(firstLine);
        if (cleaned && cleaned.length > 5 && !isGenericModelName(cleaned)) {
          return cleaned;
        }
      }
      continue;
    }

    // Handle text parts from parts array
    if (source.type === 'text' && source.text) {
      const firstLine = source.text.split('\n')[0]?.trim();
      if (firstLine) {
        const cleaned = cleanTaskText(firstLine);
        if (cleaned && cleaned.length > 5 && !isGenericModelName(cleaned)) {
          return cleaned;
        }
      }
    }
  }

  return '';
}

/**
 * Debug utility: append all info fields to docs/tmp/infos.md
 */
async function debugWriteInfoFields(info: any): Promise<void> {
  try {
    const debugDir = 'docs/tmp';
    const debugFile = `${debugDir}/infos.md`;
    let content = `--- ${new Date().toISOString()} ---\n\n`;

    // Collect all enumerable keys recursively (up to 3 levels deep)
    function flatten(obj: any, prefix: string = '', depth: number = 0): string[] {
      if (depth >= 3 || !obj || typeof obj !== 'object') {
        const val = typeof obj === 'string' ? obj : JSON.stringify(obj);
        return [`${prefix} = ${val}`];
      }
      const lines: string[] = [];
      for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const val = obj[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          lines.push(...flatten(val, fullKey, depth + 1));
        } else if (Array.isArray(val)) {
          lines.push(`${fullKey} = [array, length=${val.length}]`);
        } else {
          lines.push(`${fullKey} = ${JSON.stringify(val)}`);
        }
      }
      return lines;
    }

    content += `## Flattened Keys\n\n`;
    const keys = flatten(info);
    for (const line of keys) {
      content += `${line}\n`;
    }

    content += `\n## Raw JSON\n\n\`\`\`json\n${JSON.stringify(info, null, 2)}\n\`\`\`\n\n`;

    // Ensure directory exists
    if (typeof Bun !== 'undefined') {
      const dirExists = await Bun.file(debugDir).exists().catch(() => false);
      if (!dirExists) {
        // Create directory by writing to a placeholder file, then delete it
        const placeholder = `${debugDir}/.placeholder`;
        await Bun.write(placeholder, '', { createPath: true }).catch(() => {});
        await Bun.file(placeholder).delete().catch(() => {});
      }
      const existing = await Bun.file(debugFile).text().catch(() => '');
      await Bun.write(debugFile, existing + content);
    } else {
      const fs = await import('fs');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const existing = fs.existsSync(debugFile) ? fs.readFileSync(debugFile, 'utf8') : '';
      fs.writeFileSync(debugFile, existing + content, 'utf8');
    }
  } catch (e) {
    // Silently fail - never break the plugin
  }
}

/**
 * Clean task text by removing trailing punctuation and normalizing
 */
function cleanTaskText(text: string): string {
  if (!text) return '';
  return text.replace(/[;:,.!?]+$/, '').trim();
}

/**
 * Extract task from info metadata fields (various possible structures)
 */
function extractTaskFromInfo(info: any): string {
  if (!info) return '';

  // Try various metadata fields that might contain task info
  const taskFields = [
    // Direct fieldsz
    info.task,
    info.description,
    info.name,
    // Nested content
    info.content?.task,
    info.content?.description,
    info.content?.name,
    // Metadata object
    info.metadata?.task,
    info.metadata?.description,
    info.metadata?.name,
    // Properties (event-specific)
    info.properties?.task,
    info.properties?.description,
    info.properties?.name,
    // Message structure
    info.message?.content?.task,
    info.message?.content?.description,
    // Step info
    info.stepDescription,
    // Agent info
    info.agent?.description,
    info.agent?.task,
    // Provider/model info
    info.model,
    info.providerID,
  ];

  for (const field of taskFields) {
    if (field && typeof field === 'string' && field.trim()) {
      const cleaned = cleanTaskText(field);
      if (cleaned && cleaned.length <= MAX_TASK_DESC_LENGTH && !isGenericModelName(cleaned)) {
        return cleaned;
      }
    }
  }

  return '';
}

/**
 * Extract task from AI response content (message parts)
 */
function extractTaskFromContent(info: any): string {
  if (!info) return '';

  // Try to get from message.parts array
  const parts = info.parts || info.message?.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    // Look for text parts
    for (const part of parts) {
      if (part.type === 'text' && part.text) {
        const firstLine = part.text.split('\n')[0]?.trim();
        if (firstLine) {
          const cleaned = cleanTaskText(firstLine);
          if (cleaned && cleaned.length > 5 && !isGenericModelName(cleaned)) {
            return cleaned;
          }
        }
      }
    }
  }

  // Try from response content field
  const content = info.content || info.message?.content;
  if (content && typeof content === 'string') {
    const firstLine = content.split('\n')[0]?.trim();
    if (firstLine) {
      const cleaned = cleanTaskText(firstLine);
      if (cleaned && cleaned.length > 5 && !isGenericModelName(cleaned)) {
        return cleaned;
      }
    }
  }

  return '';
}

/**
 * Check if text is a generic model/provider name that shouldn't be used as task
 */
function isGenericModelName(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const genericPatterns = [
    'unknown',
    'opencode/',
    'opencode', // Also match "opencode" alone
    'minimax-',
    'claude-',
    'gpt-',
    'gemma-',
    'deepseek-',
    'reasoning',
    'preview',
    'free',
    'task:',
  ];
  return genericPatterns.some((pattern) => lower.includes(pattern));
}

// ===== Plugin Entry Point =====

/**
 * Main plugin factory function
 * Returns hooks object for OpenCode plugin system
 *
 * @remarks
 * - Maintains sessionStates Map to track ongoing conversations
 * - Collects text from message.part.updated for task descriptions
 * - Each completed assistant message is logged as a "step" immediately
 * - Summary with accumulated totals is written when session.idle fires
 * - Cleans up session state after logging to prevent memory leaks
 */
export const PromptRecorderPlugin = async ({
  client,
  directory,
}: {
  client: any;
  directory: string;
}) => {
  const sessionStates = new Map<string, SessionState>();
  const config: PromptRecorderConfig = await loadConfig(directory);

  initLogger(client, directory);
  await logInfo('Plugin initialized');

  /**
   * Writes the summary log for a session and cleans up state.
   * Called when session.idle fires or session.status transitions to idle.
   * Step logs have already been written as each assistant message completed.
   */
  const writeLogAndCleanup = async (sessionID: string) => {
    const state = sessionStates.get(sessionID);
    if (!state || !state.hasCompletedMessage) {
      sessionStates.delete(sessionID);
      return;
    }

    const endTime = Date.now();
    const durationMs = endTime - state.startTime;
    const durationSec = (durationMs / 1000).toFixed(2);

    const time = new Date(state.startTime).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const endTimeStr = new Date(endTime).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const totalCached = state.totalCacheRead + state.totalCacheWrite;
    const totalUncached = Math.max(0, state.totalInputTokens - totalCached);

    const logData: LogData = {
      sessionID,
      time,
      endTime: endTimeStr,
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

    // Calculate billing if enabled
    if (config.billing.enabled) {
      const modelPricing = findModelPricing(logData.model, config.billing.models);
      if (modelPricing) {
        const cost = calculateStepCost(
          logData.model,
          logData.inputTokens,
          logData.outputTokens,
          logData.cacheRead,
          logData.cacheWrite,
          modelPricing
        );
        if (cost) {
          logData.costBreakdown = cost;
        }
      }
    }

    await appendToPromptRecorder(
      directory,
      logData,
      state,
      config.outputPath,
      config.filePrefix
    );

    // Write all-logs file if saveAllLogs is enabled
    if (config.saveAllLogs && state.allUserInputs.length > 0) {
      const allLogsData: AllLogsData = {
        sessionID,
        startTime: time,
        endTime: endTimeStr,
        userInputs: state.allUserInputs,
        userInputTimes: state.allUserInputTimes,
        assistantOutputs: state.allAssistantOutputs,
        assistantOutputTimes: state.allAssistantOutputTimes,
      };

      await appendAllLogsToPromptRecorder(
        directory,
        sessionID,
        state.sessionStartTime,
        allLogsData,
        config.outputPath
      );
    }

    sessionStates.delete(sessionID);
    await logInfo('Session summary logged', {
      sessionID,
      steps: state.stepCount,
      duration: durationSec,
      totalTokens: logData.totalTokens,
    });
  };

  return {
    /**
     * chat.message hook - captures user messages when sent
     * Records initial session state including prompt, model, and agent chain
     * If session already exists with completed messages, writes summary first then starts fresh
     */
    'chat.message': async (input: any, output: any) => {
      try {
        const sessionID = input.sessionID;
        if (!sessionID) return;

        // Check if session already exists with completed messages - need to write summary first
        const existingState = sessionStates.get(sessionID);
        if (existingState && existingState.hasCompletedMessage && existingState.headerWritten) {
          await writeLogAndCleanup(sessionID);
        }

        const prompt = extractPromptFromParts(output.parts);
        const model = extractModelFromInput(input);

        let agentChain: string[] = [];
        if (input.agent) {
          agentChain = [input.agent];
        }

        if (output.parts && Array.isArray(output.parts)) {
          const agentsFromParts = extractAgentChain(output.parts);
          if (agentsFromParts.length > 0) {
            agentChain = agentsFromParts;
          }
        }

        const now = new Date();
        const sessionStartTime = formatDateForFileName(now);

        const state: SessionState = {
          userMsgID: output.message?.id || sessionID,
          prompt,
          model,
          startTime: Date.now(),
          agentChain,
          sessionStartTime,
          completedMessageIDs: new Set<string>(),
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalContextTokens: 0,
          totalCacheRead: 0,
          totalCacheWrite: 0,
          lastModel: model,
          hasCompletedMessage: false,
          stepCount: 0,
          headerWritten: false,
          messageTexts: new Map<string, string>(),
          lastStepEndTime: Date.now(),
          allUserInputs: [],
          allUserInputTimes: [],
          allAssistantOutputs: [],
          allAssistantOutputTimes: [],
          allLogsFilePath: null,
        };

        sessionStates.set(sessionID, state);

        // Collect user input for all-logs feature
        if (config.saveAllLogs && prompt) {
          state.allUserInputs.push(prompt);
          const inputTime = new Date().toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          });
          state.allUserInputTimes.push(inputTime);
        }

        await logInfo('chat.message handled', {
          sessionID,
          promptLength: prompt.length,
          model,
          agents: agentChain,
        });

        if (sessionStates.size > 100) {
          const firstKey = sessionStates.keys().next().value;
          if (firstKey) {
            sessionStates.delete(firstKey);
          }
        }
      } catch (error) {
        await logError('Error in chat.message hook', { error: String(error) });
      }
    },

    /**
     * event hook - monitors message parts, assistant completion, and session state
     *
     * Flow:
     * 1. message.part.updated → collect text content per message for task descriptions
     * 2. message.updated (completed assistant) → write step log + accumulate tokens
     * 3. session.idle → write summary log with all accumulated data
     * 4. session.status (idle) → fallback trigger for writing summary
     */
    event: async ({ event }: { event: any }) => {
      try {
        // Handle session.idle
        if (event.type === 'session.idle') {
          const sessionID = event.properties?.sessionID;
          if (!sessionID) return;
          await writeLogAndCleanup(sessionID);
          return;
        }

        // Handle session.status with idle status
        if (event.type === 'session.status') {
          const status = event.properties?.status;
          if (status?.type === 'idle') {
            const sessionID = event.properties?.sessionID;
            if (!sessionID) return;
            await writeLogAndCleanup(sessionID);
            return;
          }
          return;
        }

        // Collect text content from message.part.updated for task descriptions
        if (event.type === 'message.part.updated') {
          const part = event.properties?.part;
          if (!part || !part.text) return;

          const sessionID = part.sessionID;
          if (!sessionID) return;

          const state = sessionStates.get(sessionID);
          if (!state) return;

          const partType = part.type || 'text';

          // Collect for task description (existing behavior)
          // For text type: use first line for task description
          // For thinking/reasoning type: collect but mark separately
          const key = `step-${state.stepCount + 1}`;
          const thinkingKey = `step-thinking-${state.stepCount + 1}`;

          if (partType === 'text') {
            const existing = state.messageTexts.get(key) || '';
            state.messageTexts.set(key, existing + part.text);
          } else if (partType === 'thinking' || partType === 'reasoning') {
            const existing = state.messageTexts.get(thinkingKey) || '';
            state.messageTexts.set(thinkingKey, existing + part.text);
          } else {
            // Unknown type - collect as text anyway
            const existing = state.messageTexts.get(key) || '';
            state.messageTexts.set(key, existing + part.text);
          }

          // Collect for all-logs feature (include ALL content types)
          if (config.saveAllLogs) {
            const assistantKey = `all-assistant-${state.stepCount + 1}`;
            const existingAssistant = state.messageTexts.get(assistantKey) || '';
            state.messageTexts.set(assistantKey, existingAssistant + part.text);
          }
          return;
        }

        // Only process message.updated events for step logging
        if (event.type !== 'message.updated') return;

        const { info } = event.properties || {};
        if (!info || info.role !== 'assistant') return;

        const sessionID = info.sessionID;
        if (!sessionID) {
          await logError('No sessionID found for assistant message', { messageID: info.id });
          return;
        }

        const state = sessionStates.get(sessionID);
        if (!state) return;

        const messageID = info.id;
        if (messageID && state.completedMessageIDs.has(messageID)) return;

        // Check if this assistant message is complete with token data
        const isComplete = info.time?.completed;
        const primaryTokens = info.tokens;
        const hasFullTokens =
          primaryTokens &&
          primaryTokens.input > 0 &&
          primaryTokens.output > 0 &&
          primaryTokens.reasoning !== undefined;

        const hasUsageTokens =
          info.usage &&
          (info.usage.prompt_tokens > 0 || info.usage.input_tokens > 0) &&
          (info.usage.completion_tokens > 0 || info.usage.output_tokens > 0);

        if (!isComplete || (!hasFullTokens && !hasUsageTokens)) return;

        // Extract token counts
        const tokens = extractTokens(info);
        const cachedTokens = tokens.cacheRead + tokens.cacheWrite;
        const uncachedTokens = Math.max(0, tokens.input - cachedTokens);

        // Increment step count
        state.stepCount += 1;
        const stepNumber = state.stepCount;

        // Determine model for this step
        const stepModel =
          info.providerID && info.modelID
            ? `${info.providerID}/${info.modelID}`
            : state.lastModel || state.model || 'unknown';

        // Calculate step duration (time since last step completed)
        const stepEndTime = Date.now();
        const stepDurationSec = ((stepEndTime - state.lastStepEndTime) / 1000).toFixed(2);

        const stepTime = new Date(stepEndTime).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

        const agentName = extractAgentFromInfo(info);

        // Get task description from accumulated text using step number as key
        // Key matches: message.part.updated stores at `step-${stepCount + 1}` before increment
        const key = `step-${stepNumber}`;
        const thinkingKey = `step-thinking-${stepNumber}`;
        const combinedText = state.messageTexts.get(key) || '';
        const thinkingText = state.messageTexts.get(thinkingKey) || '';
        const taskDescription = extractTaskDescription(combinedText, info, thinkingText);
        // Clean up text buffer after retrieval
        state.messageTexts.delete(key);
        state.messageTexts.delete(thinkingKey);

        // Move accumulated assistant text to all-logs arrays for all-logs feature
        if (config.saveAllLogs) {
          const assistantKey = `all-assistant-${stepNumber}`;
          const thinkingKey = `all-thinking-${stepNumber}`;
          let assistantText = state.messageTexts.get(assistantKey) || '';
          const thinkingText = state.messageTexts.get(thinkingKey) || '';

          // Combine thinking content with regular output
          if (thinkingText) {
            assistantText = thinkingText + assistantText;
          }

          if (assistantText.trim()) {
            state.allAssistantOutputs.push(assistantText);
            state.allAssistantOutputTimes.push(stepTime);
          }
          state.messageTexts.delete(assistantKey);
          state.messageTexts.delete(thinkingKey);
        }

        // Write step log immediately
        const step: MessageStep = {
          stepNumber,
          messageID: messageID || `step-${stepNumber}`,
          agent: agentName,
          model: stepModel,
          time: stepTime,
          duration: stepDurationSec,
          taskDescription,
          totalTokens: tokens.input + tokens.output,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          cachedTokens,
          uncachedTokens,
          cacheRead: tokens.cacheRead,
          cacheWrite: tokens.cacheWrite,
        };

        const isFirstStep = !state.headerWritten;
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
        state.headerWritten = true;

        // Accumulate tokens into session state
        state.totalInputTokens += tokens.input;
        state.totalOutputTokens += tokens.output;
        state.totalContextTokens += tokens.context;
        state.totalCacheRead += tokens.cacheRead;
        state.totalCacheWrite += tokens.cacheWrite;

        if (info.providerID && info.modelID) {
          state.lastModel = `${info.providerID}/${info.modelID}`;
        }

        if (messageID) {
          state.completedMessageIDs.add(messageID);
        }

        state.hasCompletedMessage = true;
        state.lastStepEndTime = stepEndTime; // Update for next step's duration calculation

        await logInfo('Step logged + tokens accumulated', {
          sessionID,
          step: stepNumber,
          messageID,
          agent: agentName,
          model: stepModel,
          totalTokens: step.totalTokens,
          cachedTokens,
          uncachedTokens,
        });
      } catch (error) {
        await logError('Error in event hook', { error: String(error) });
      }
    },
  };
};
