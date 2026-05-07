// OpenCode Prompt Log Plugin
// 记录 prompt、模型、agent、耗时和 token 使用到 Markdown 文件

import type { SessionState, LogData } from "./types"
import { appendToPromptLog } from "./utils/file-writer"
import { extractAgentChain } from "./utils/agent-extractor"
import { initLogger, logInfo, logError } from "./utils/logger"

function mergeAgentChains(initialAgents: string[], extractedAgents: string[]): string[] {
  const merged: string[] = []
  const seen = new Set<string>()

  for (const agent of initialAgents) {
    if (!seen.has(agent)) {
      merged.push(agent)
      seen.add(agent)
    }
  }

  for (const agent of extractedAgents) {
    if (!seen.has(agent)) {
      merged.push(agent)
      seen.add(agent)
    }
  }

  return merged
}

function formatDateForFileName(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// 从 output.parts 中提取用户输入的文本
function extractPromptFromParts(parts: any[]): string {
  if (!parts || !Array.isArray(parts)) return ""
  return parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("\n")
}

function extractModelFromInput(input: any): string {
  if (input.model) {
    if (input.model.providerID && input.model.modelID) {
      return `${input.model.providerID}/${input.model.modelID}`
    }
    if (typeof input.model === "string") {
      return input.model
    }
  }
  return "unknown"
}

// ===== 插件入口 =====
export const PromptLogPlugin = async ({ client, directory }: { client: any, directory: string }) => {
  const sessionStates = new Map<string, SessionState>()
  const messageTexts = new Map<string, string>()

  initLogger(client, directory)
  await logInfo("Plugin initialized")

  return {
    // 通过 chat.message hook 捕获用户发送的消息，记录初始状态
    "chat.message": async (input: any, output: any) => {
      try {
        const sessionID = input.sessionID
        if (!sessionID) return

        // 文本内容在 output.parts 中，不在 output.message 中
        const prompt = extractPromptFromParts(output.parts)
        const model = extractModelFromInput(input)

        let agentChain: string[] = []
        if (input.agent) {
          agentChain = [input.agent]
        }

        if (output.parts && Array.isArray(output.parts)) {
          const agentsFromParts = extractAgentChain(output.parts)
          if (agentsFromParts.length > 0) {
            agentChain = agentsFromParts
          }
        }

        const now = new Date()
        const sessionStartTime = formatDateForFileName(now)

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

        // 清理旧状态（保留最近100条）
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

    // 通过 event hook 监听 message.updated 事件，获取 assistant 回复的 token 信息
    event: async ({ event }: { event: any }) => {
      try {
        // 收集 message part 的文本增量
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

        if (event.type !== "message.updated") return

        const { info } = event.properties || {}
        if (!info || info.role !== "assistant") return

        // 只在 assistant 消息完成时记录（有 time.completed 或 finish 标记）
        const isComplete = info.time?.completed || info.finish
        if (!isComplete) return

        const sessionID = info.sessionID
        if (!sessionID) {
          await logError("No sessionID found for assistant message", { messageID: info.id })
          return
        }

        const state = sessionStates.get(sessionID)
        if (!state) {
          return
        }

        const endTime = Date.now()
        const durationMs = endTime - state.startTime
        const durationSec = (durationMs / 1000).toFixed(2)

        let agentChain = state.agentChain

        // 提取 token 信息
        // AssistantMessage.tokens 结构: { input, output, reasoning, cache: { read, write } }
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

        const inputTokens = tokens.input || 0
        const outputTokens = tokens.output || 0
        const contextTokens = tokens.context || 0
        const cacheRead = tokens.cache?.read || 0
        const cacheWrite = tokens.cache?.write || 0

        const time = new Date(state.startTime).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        })

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

        await appendToPromptLog(directory, logData, state)

        sessionStates.delete(sessionID)
        await logInfo("Logged", { sessionID, duration: durationSec, inputTokens, outputTokens })
      } catch (error) {
        await logError("Error in event hook", { error: String(error) })
      }
    }
  }
}
