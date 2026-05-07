/**
 * OpenCode Prompt Log Plugin - Main Entry Point
 *
 * This plugin records each conversation's prompt, model, agent call chain,
 * duration, and token usage to daily Markdown files.
 *
 * Hooks used:
 * - chat.message: Captures user messages when sent, records initial state
 * - event: Monitors message.updated for step logging and session.idle for summary
 *
 * Key design: In agent workflows (e.g., Sisyphus - Ultraworker), multiple
 * assistant messages may complete within a single session. Each completed
 * assistant message is logged as a "step" immediately, providing real-time
 * visibility. When the session goes idle, a summary with accumulated totals
 * is written.
 *
 * Output: <project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md
 */

import type { SessionState, LogData, MessageStep } from './types';
import { appendToPromptLog, appendStepToPromptLog } from './utils/file-writer';
import { extractAgentChain } from './utils/agent-extractor';
import { initLogger, logInfo, logError } from './utils/logger';

/**
 * Merges two agent chain arrays, removing duplicates
 * Initial agents from input are preserved, extracted agents are added if not present
 *
 * @param initialAgents - Agent chain from input context
 * @param extractedAgents - Agent chain extracted from message parts
 * @returns Merged array with unique agent names in order
 */
function mergeAgentChains(initialAgents: string[], extractedAgents: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  // Add initial agents first
  for (const agent of initialAgents) {
    if (!seen.has(agent)) {
      merged.push(agent);
      seen.add(agent);
    }
  }

  // Append extracted agents that aren't already included
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
 *
 * @param date - JavaScript Date object
 * @returns Formatted date string
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
 *
 * @param parts - Array of message parts from output.parts
 * @returns Joined text content or empty string if no text parts
 *
 * @remarks
 * - User input is stored in output.parts, not output.message
 * - Multiple text parts may exist for different content blocks
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
 *
 * @param input - Input context from chat.message hook
 * @returns Model identifier string or 'unknown' if not found
 */
function extractModelFromInput(input: any): string {
  if (input.model) {
    // Object format: { providerID: 'opencode', modelID: 'hy3-preview-free' }
    if (input.model.providerID && input.model.modelID) {
      return `${input.model.providerID}/${input.model.modelID}`;
    }
    // Direct string format
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
 * @param info - Assistant message info object
 * @returns Object with input, output, context, cacheRead, cacheWrite counts
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
 * Tries multiple sources in order of preference
 *
 * @param info - Assistant message info object
 * @returns Agent name string or 'unknown' if not found
 */
function extractAgentFromInfo(info: any): string {
  // Try info.agent first (explicit agent field)
  if (info.agent) {
    return typeof info.agent === 'string' ? info.agent : info.agent.name || 'unknown';
  }
  // Try providerID as agent hint
  if (info.providerID) {
    return info.providerID;
  }
  return 'unknown';
}

// ===== Plugin Entry Point =====

/**
 * Main plugin factory function
 * Returns hooks object for OpenCode plugin system
 *
 * @param client - OpenCode client instance for logging
 * @param directory - Project directory path for log file storage
 * @returns Plugin hooks object with chat.message and event handlers
 *
 * @remarks
 * - Maintains sessionStates Map to track ongoing conversations
 * - Each completed assistant message is logged as a "step" immediately
 * - Summary with accumulated totals is written when session.idle fires
 * - Cleans up session state after logging to prevent memory leaks
 */
export const PromptLogPlugin = async ({
  client,
  directory,
}: {
  client: any;
  directory: string;
}) => {
  // Map to store session state from message start until session goes idle
  const sessionStates = new Map<string, SessionState>();

  // Initialize logger with client and directory
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
      // No completed messages to log, just clean up
      sessionStates.delete(sessionID);
      return;
    }

    // Calculate conversation duration from start to now (session idle time)
    const endTime = Date.now();
    const durationMs = endTime - state.startTime;
    const durationSec = (durationMs / 1000).toFixed(2);

    // Format start time as HH:MM:SS
    const time = new Date(state.startTime).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    // Construct summary log data with accumulated tokens
    const logData: LogData = {
      sessionID,
      time,
      agentChain: state.agentChain.join(' → ') || 'unknown',
      model: state.lastModel || state.model || 'unknown',
      prompt: state.prompt,
      duration: durationSec,
      steps: state.stepCount,
      inputTokens: state.totalInputTokens,
      outputTokens: state.totalOutputTokens,
      contextTokens: state.totalContextTokens,
      cacheRead: state.totalCacheRead,
      cacheWrite: state.totalCacheWrite,
    };

    // Write summary to Markdown file
    await appendToPromptLog(directory, logData, state);

    // Clean up session state after logging
    sessionStates.delete(sessionID);
    await logInfo('Session summary logged', {
      sessionID,
      steps: state.stepCount,
      duration: durationSec,
      inputTokens: state.totalInputTokens,
      outputTokens: state.totalOutputTokens,
    });
  };

  return {
    /**
     * chat.message hook - captures user messages when sent
     * Records initial session state including prompt, model, and agent chain
     */
    'chat.message': async (input: any, output: any) => {
      try {
        const sessionID = input.sessionID;
        if (!sessionID) return;

        // Extract prompt text from output.parts (not output.message)
        const prompt = extractPromptFromParts(output.parts);
        const model = extractModelFromInput(input);

        // Build initial agent chain from input context
        let agentChain: string[] = [];
        if (input.agent) {
          agentChain = [input.agent];
        }

        // Also check message parts for any agent calls
        if (output.parts && Array.isArray(output.parts)) {
          const agentsFromParts = extractAgentChain(output.parts);
          if (agentsFromParts.length > 0) {
            agentChain = agentsFromParts;
          }
        }

        const now = new Date();
        const sessionStartTime = formatDateForFileName(now);

        // Create session state object with initialized accumulation fields
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
        };

        sessionStates.set(sessionID, state);
        await logInfo('chat.message handled', {
          sessionID,
          promptLength: prompt.length,
          model,
          agents: agentChain,
        });

        // Memory management: clean up old states (keep most recent 100)
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
     * event hook - monitors assistant message completion and session state
     *
     * Flow:
     * 1. message.updated (completed assistant) → write step log immediately + accumulate tokens
     * 2. session.idle → write summary log with all accumulated data
     * 3. session.status (idle) → fallback trigger for writing summary
     *
     * Each step is logged as soon as it completes, providing real-time visibility
     * into agent workflows. The summary captures the full session totals.
     */
    event: async ({ event }: { event: any }) => {
      try {
        // Handle session.idle - the entire session is done, write the summary log
        if (event.type === 'session.idle') {
          const sessionID = event.properties?.sessionID;
          if (!sessionID) return;
          await writeLogAndCleanup(sessionID);
          return;
        }

        // Handle session.status with idle status (alternative signal)
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

        // Only process message.updated events for step logging
        if (event.type !== 'message.updated') return;

        const { info } = event.properties || {};
        if (!info || info.role !== 'assistant') return;

        const sessionID = info.sessionID;
        if (!sessionID) {
          await logError('No sessionID found for assistant message', { messageID: info.id });
          return;
        }

        // Retrieve stored session state
        const state = sessionStates.get(sessionID);
        if (!state) {
          return;
        }

        // Skip if this message has already been processed (avoid double-counting)
        const messageID = info.id;
        if (messageID && state.completedMessageIDs.has(messageID)) {
          return;
        }

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

        // If not complete or tokens not yet available, skip and wait for next event
        if (!isComplete || (!hasFullTokens && !hasUsageTokens)) {
          return;
        }

        // Extract token counts from this completed message
        const tokens = extractTokens(info);

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

        // Format step completion time as HH:MM:SS
        const stepTime = new Date(stepEndTime).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

        // Extract agent name for this step
        const agentName = extractAgentFromInfo(info);

        // Write step log immediately
        const step: MessageStep = {
          stepNumber,
          messageID: messageID || `step-${stepNumber}`,
          agent: agentName,
          model: stepModel,
          time: stepTime,
          duration: stepDurationSec,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          contextTokens: tokens.context,
          cacheRead: tokens.cacheRead,
          cacheWrite: tokens.cacheWrite,
        };

        const isFirstStep = !state.headerWritten;
        await appendStepToPromptLog(
          directory,
          sessionID,
          state.sessionStartTime,
          step,
          isFirstStep,
          state.prompt
        );
        state.headerWritten = true;

        // Accumulate tokens into session state
        state.totalInputTokens += tokens.input;
        state.totalOutputTokens += tokens.output;
        state.totalContextTokens += tokens.context;
        state.totalCacheRead += tokens.cacheRead;
        state.totalCacheWrite += tokens.cacheWrite;

        // Update model from this message (use latest in agent chain)
        if (info.providerID && info.modelID) {
          state.lastModel = `${info.providerID}/${info.modelID}`;
        }

        // Mark this message as processed
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
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          totalInput: state.totalInputTokens,
          totalOutput: state.totalOutputTokens,
        });
      } catch (error) {
        await logError('Error in event hook', { error: String(error) });
      }
    },
  };
};
