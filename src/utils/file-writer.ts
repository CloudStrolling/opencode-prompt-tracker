import type { LogData, SessionState } from "../types"
import { logInfo, logError } from "./logger"

const FILE_HEADER = `# Prompt Log - Session

`

function formatLogEntry(data: LogData): string {
  return `## ${data.time}

- **模型**: ${data.model}
- **Agent 调用链**: ${data.agentChain}
- **耗时**: ${data.duration}s
- **Input Tokens**: ${data.inputTokens}
- **Output Tokens**: ${data.outputTokens}
- **Context Tokens**: ${data.contextTokens}
- **Cache Read**: ${data.cacheRead}
- **Cache Write**: ${data.cacheWrite}

### Prompt
${data.prompt}

---

`
}

export async function appendToPromptLog(
  directory: string,
  data: LogData,
  sessionState: SessionState
): Promise<void> {
  // 文件名格式: opencode-prompt-YYYY-MM-DD_<sessionID>.md
  // 同一个 sessionID 的多轮对话追加到同一个文件
  const dateStr = sessionState.sessionStartTime.substring(0, 10) // YYYY-MM-DD
  const fileName = `opencode-prompt-${dateStr}_${data.sessionID}.md`
  const promptsDir = `${directory}/.opencode/prompts`
  const filePath = `${promptsDir}/${fileName}`

  const entry = formatLogEntry(data)

  try {
    if (typeof Bun !== "undefined") {
      try {
        await Bun.write(`${promptsDir}/.keep`, "", { createPath: true })
      } catch (e) {
        try {
          await Bun.spawn(["mkdir", "-p", promptsDir], { stderr: "pipe" })
        } catch (spawnError) {
          await logError("Failed to create directory", { dir: promptsDir, error: String(spawnError) })
        }
      }

      const file = Bun.file(filePath)
      const fileExists = await file.exists()

      let existingContent = ""
      if (fileExists) {
        existingContent = await file.text()
      }

      const content = (fileExists ? existingContent : FILE_HEADER) + entry
      await Bun.write(filePath, content)
    } else {
      const fs = await import("fs")

      if (!fs.existsSync(promptsDir)) {
        fs.mkdirSync(promptsDir, { recursive: true })
      }

      const headerIfNeeded = !fs.existsSync(filePath) ? FILE_HEADER : ""
      fs.appendFileSync(filePath, headerIfNeeded + entry, "utf8")
    }

    await logInfo("Logged prompt", { file: fileName, sessionID: data.sessionID, duration: data.duration, inputTokens: data.inputTokens, outputTokens: data.outputTokens })
  } catch (error) {
    await logError("Failed to write log", { file: fileName, error: String(error) })
    throw error
  }
}
