/**
 * OpenCode Prompt Log Plugin - Main Entry Point
 * 
 * This plugin records each conversation's prompt, model, agent call chain,
 * duration, and token usage to daily Markdown files.
 * 
 * Hooks used:
 * - chat.message: Captures user messages when sent, records initial state
 * - event: Monitors message.updated events for assistant completion with tokens
 * 
 * Output: <project>/.opencode/prompts/opencode-prompt-YYYY-MM-DD_<sessionID>.md
 */

import type { SessionState, LogData } from "./types"
import { appendToPromptLog } from "./utils/file-writer"
import { extractAgentChain } from "./utils/agent-extractor"
import { initLogger, logInfo, logError } from "./utils/logger"

/**
 * Merges two agent chain arrays, removing duplicates
 * Initial agents from input are preserved, extracted agents are added if not present
 * 
 * @param initialAgents - Agent chain from input context
 * @param extractedAgents - Agent chain extracted from message parts
 * @returns Merged array with unique agent names in order
 */
function mergeAgentChains(initialAgents: string[], extractedAgents: string[]): string[] {
  const merged: string[] = []
  const seen = new Set<string>()

  // Add initial agents first
  for (const agent of initialAgents) {
    if (!seen.has(agent)) {
      merged.push(agent)
      seen.add(agent)
    }
  }

  // Append extracted agents that aren't already included
  for (const agent of extractedAgents) {
    if (!seen.has(agent)) {
      merged.push(agent)
      seen.add(agent)
    }
  }

  return merged
}

/**
 * Formats a Date object into YYYY-MM-DD string for file naming
 * 
 * @param date - JavaScript Date object
 * @returns Formatted date string
 */
function formatDateForFileName(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
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
  if (!parts || !Array.isArray(parts)) return ""
  return parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("\n")
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
      return `${input.model.providerID}/${input.model.modelID}`
    }
    // Direct string format
    if (typeof input.model === "string") {
      return input.model
    }
  }
  return "unknown"
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
 * - Stores partial text in messageTexts for incremental message updates
 * - Cleans up session state after logging to prevent memory leaks
 */
export const PromptLogPlugin = async ({ client, directory }: { client: any, directory: string }) => {
  // Map to store session state from message start until completion
  const sessionStates = new Map<string, SessionState>()
  // Map to accumulate incremental text updates for assistant messages
  const messageTexts = new Map<string, string>()

  // Initialize logger with client and directory
  initLogger(client, directory)
  await logInfo("Plugin initialized")

  return {
    /**
     * chat.message hook - captures user messages when sent
     * Records initial session state including prompt, model, and agent chain
     */
    "chat.message": async (input: any, output: any) => {
      try {
        const sessionID = input.sessionID
        if (!sessionID) return

        // Extract prompt text from output.parts (not output.message)
        const prompt = extractPromptFromParts(output.parts)
        const model = extractModelFromInput(input)

        // Build initial agent chain from input context
        let agentChain: string[] = []
        if (input.agent) {
          agentChain = [input.agent]
        }

        // Also check message parts for any agent calls
        if (output.parts && Array.isArray(output.parts)) {
          const agentsFromParts = extractAgentChain(output.parts)
          if (agentsFromParts.length > 0) {
            agentChain = agentsFromParts
          }
        }

        const now = new Date()
        const sessionStartTime = formatDateForFileName(now)

        // Create session state object to store until response completes
        const state: SessionState = {
          userMsgID: output.message?.id || sessionID,
          prompt,
          model,
          startTime: Date.now(),
          agentChain,
          sessionStartTime
        }

        sessionStates.set(sessionID, state)
        await logInfo("chat.message handled", { sessionID, promptLength: prompt.length, model, agents: agentChain })

        // Memory management: clean up old states (keep most recent 100)
        if (sessionStates.size > 100) {
          const firstKey = sessionStates.keys().next().value
          if (firstKey) {
            sessionStates.delete(firstKey)
          }
        }
      } catch (error) {
        await logError("Error in chat.message hook", { error: String(error) })
      }
    },

    /**
     * event hook - monitors assistant message completion
     * Captures token usage and writes log entry when response finishes
     */
    event: async ({ event }: { event: any }) => {
      try {
        // Handle incremental text updates (message.part.updated)
        // Accumulates text deltas for assistant messages
        if (event.type === "message.part.updated") {
          const part = event.properties?.part || event.part
          if (!part || part.type !== "text") return

          const messageID = part.messageID
          if (!messageID) return

          const delta = event.properties?.delta || event.delta || ""
          const existing = messageTexts.get(messageID) || ""
          const newText = delta || part.text || ""
          messageTexts.set(messageID, existing + newText)
          return
        }

        // Only process message.updated events
        if (event.type !== "message.updated") return

        const { info } = event.properties || {}
        if (!info || info.role !== "assistant") return

        // Only log when assistant message is complete
        // Check for completion markers: time.completed or finish flag
        const isComplete = info.time?.completed || info.finish
        if (!isComplete) return

        const sessionID = info.sessionID
        if (!sessionID) {
          await logError("No sessionID found for assistant message", { messageID: info.id })
          return
        }

        // Retrieve stored session state
        const state = sessionStates.get(sessionID)
        if (!state) {
          return
        }

        // Calculate conversation duration
        const endTime = Date.now()
        const durationMs = endTime - state.startTime
        const durationSec = (durationMs / 1000).toFixed(2)

        let agentChain = state.agentChain

        // Extract token information from assistant message
        // Primary: info.tokens structure { input, output, reasoning, cache: { read, write } }
        // Fallback: info.usage structure (older API)
        let tokens: any = info.tokens || {}
        if (!info.tokens && info.usage) {
          tokens = {
            input: info.usage.prompt_tokens || info.usage.input_tokens,
            output: info.usage.completion_tokens || info.usage.output_tokens,
            cache: {
              read: info.usage.cache_read_input_tokens || 0,
              write: info.usage.cache_creation_input_tokens || 0
            }
          }
        }

        // Extract token counts with fallback defaults
        const inputTokens = tokens.input || 0
        const outputTokens = tokens.output || 0
        const contextTokens = tokens.context || 0
        const cacheRead = tokens.cache?.read || 0
        const cacheWrite = tokens.cache?.write || 0

        // Format start time as HH:MM:SS
        const time = new Date(state.startTime).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        })

        // Construct complete log data
        const logData: LogData = {
          sessionID,
          time,
          agentChain: agentChain.join(" → ") || "unknown",
          model: state.model || `${info.providerID}/${info.modelID}` || "unknown",
          prompt: state.prompt,
          duration: durationSec,
          inputTokens,
          outputTokens,
          contextTokens,
          cacheRead,
          cacheWrite
        }

        // Write to Markdown file
        await appendToPromptLog(directory, logData, state)

        // Clean up session state after logging
        sessionStates.delete(sessionID)
        await logInfo("Logged", { sessionID, duration: durationSec, inputTokens, outputTokens })
      } catch (error) {
        await logError("Error in event hook", { error: String(error) })
      }
    }
  }
}