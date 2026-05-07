import type { LogData } from "../types"

let clientRef: any = null
let logFilePath: string = ""

export function initLogger(client: any, directory: string) {
  clientRef = client
  logFilePath = `${directory}/.opencode/prompts/.plugin-log`
}

async function writeToFile(level: string, message: string, extra?: any) {
  try {
    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] [${level}] ${message}${extra ? " " + JSON.stringify(extra) : ""}\n`

    if (typeof Bun !== "undefined") {
      const file = Bun.file(logFilePath)
      const existing = await file.exists() ? await file.text() : ""
      await Bun.write(logFilePath, existing + line)
    } else {
      const fs = await import("fs")
      fs.appendFileSync(logFilePath, line, "utf8")
    }
  } catch {
    // 如果文件写入失败，静默忽略
  }
}

export async function logInfo(message: string, extra?: any) {
  // 优先使用 OpenCode 的 client.app.log
  if (clientRef?.app?.log) {
    try {
      await clientRef.app.log({
        body: {
          service: "prompt-log",
          level: "info",
          message,
          extra: extra || {},
        },
      })
      return
    } catch {
      // fallback to file
    }
  }
  await writeToFile("INFO", message, extra)
}

export async function logError(message: string, extra?: any) {
  if (clientRef?.app?.log) {
    try {
      await clientRef.app.log({
        body: {
          service: "prompt-log",
          level: "error",
          message,
          extra: extra || {},
        },
      })
      return
    } catch {
      // fallback to file
    }
  }
  await writeToFile("ERROR", message, extra)
}
