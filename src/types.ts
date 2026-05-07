export interface SessionState {
  userMsgID: string
  prompt: string
  model: string
  startTime: number
  agentChain: string[]
  sessionStartTime: string
}

export interface LogData {
  sessionID: string
  time: string
  agentChain: string
  model: string
  prompt: string
  duration: string
  inputTokens: number
  outputTokens: number
  contextTokens: number
  cacheRead: number
  cacheWrite: number
}
