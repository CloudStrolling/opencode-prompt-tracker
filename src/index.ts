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

import type { SessionState, LogData, MessageStep, PromptRecorderConfig } from './types';
import { appendToPromptRecorder, appendStepToPromptRecorder } from './utils/file-writer';
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
 */
function extractAgentFromInfo(info: any): string {
  if (info.agent) {
    return typeof info.agent === 'string' ? info.agent : info.agent.name || 'unknown';
  }
  if (info.providerID) {
    return info.providerID;
  }
  return 'unknown';
}

/**
 * Extracts a brief task description from accumulated message text
 * Method 1: Takes the first non-empty line, truncated to MAX_TASK_DESC_LENGTH
 * Method 2 (fallback): Extract from message content metadata
 */
function extractTaskDescription(text: string, info?: any): string {
  if (!text) {
    // Fallback: try to get task from info.metadata or other fields
    return extractTaskFromInfo(info);
  }

  const firstLine = text.split('\n').find((line) => line.trim().length > 0) || '';
  const trimmed = firstLine.trim();

  // Remove trailing punctuation (colon, semicolon, period, etc.)
  const cleaned = trimmed.replace(/[;:,.!?]+$/, '').trim();

  if (!cleaned) {
    return extractTaskFromInfo(info);
  }

  if (cleaned.length <= MAX_TASK_DESC_LENGTH) return cleaned;
  return cleaned.substring(0, MAX_TASK_DESC_LENGTH) + '...';
}

/**
 * Fallback method to extract task description from message info metadata
 */
function extractTaskFromInfo(info: any): string {
  if (!info) return '';

  // Try various metadata fields that might contain task info
  const taskFields = [
    info.task,
    info.description,
    info.content?.task,
    info.content?.description,
    info.metadata?.task,
    info.metadata?.description,
  ];

  for (const field of taskFields) {
    if (field && typeof field === 'string' && field.trim()) {
      // Clean up trailing punctuation
      return field.trim().replace(/[;:,.!?]+$/, '').trim();
    }
  }

  return '';
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

    const totalCached = state.totalCacheRead + state.totalCacheWrite;
    const totalUncached = Math.max(0, state.totalInputTokens - totalCached);

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
        };

        sessionStates.set(sessionID, state);
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
          if (!part || part.type !== 'text' || !part.text) return;

          const sessionID = part.sessionID;
          const messageID = part.messageID;
          if (!sessionID || !messageID) return;

          const state = sessionStates.get(sessionID);
          if (!state) return;

          // Append text to the message's accumulated text buffer
          const existing = state.messageTexts.get(messageID) || '';
          state.messageTexts.set(messageID, existing + part.text);
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

        // Calculate step duration
        const stepEndTime = Date.now();
        const stepDurationSec = ((stepEndTime - state.startTime) / 1000).toFixed(2);

        const stepTime = new Date(stepEndTime).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

        const agentName = extractAgentFromInfo(info);

        // Get task description from accumulated text (with info fallback)
        const messageText = state.messageTexts.get(messageID || '') || '';
        const taskDescription = extractTaskDescription(messageText, info);
        // Clean up text buffer for this message
        if (messageID) {
          state.messageTexts.delete(messageID);
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
