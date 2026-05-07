export function extractAgentChain(parts: any[]): string[] {
  const agents: string[] = []
  
  for (const part of parts) {
    if (part.type === "agent" && part.name) {
      agents.push(part.name)
    } else if (part.type === "subtask" && part.agent) {
      agents.push(part.agent)
    }
  }
  
  return agents
}
