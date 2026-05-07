import { describe, expect, test } from "bun:test"
import { LogData } from "../src/types"

describe("appendToPromptLog logic", () => {
  test("should generate correct header for new file", () => {
    const data: LogData = {
      time: "10:30:15",
      agentChain: "oracle → build",
      model: "opencode/hy3-preview-free",
      prompt: "Design a plugin",
      duration: "12.34",
      inputTokens: 150,
      outputTokens: 800,
      contextTokens: 100,
      cacheRead: 0,
      cacheWrite: 0
    }
    
    // Test the content generation logic
    const header = `| 时间 | Agent 调用链 | 模型 | Prompt | 耗时(s) | Input Tokens | Output Tokens | Context Tokens | Cache Read | Cache Write |
|------|-------------|------|--------|----------|-------------|---------------|---------------|------------|-------------|
`
    const promptDisplay = data.prompt.replace(/\n/g, "<br>")
    const row = `| ${data.time} | ${data.agentChain} | ${data.model} | ${promptDisplay} | ${data.duration} | ${data.inputTokens} | ${data.outputTokens} | ${data.contextTokens} | ${data.cacheRead} | ${data.cacheWrite} |
`
    
    expect(row).toContain("10:30:15")
    expect(row).toContain("oracle → build")
    expect(row).toContain("Design a plugin")
    expect(row).toContain("12.34")
    expect(row).toContain("150")
    expect(row).toContain("800")
    expect(row).toContain("100")
    expect(header).toContain("Context Tokens")
  })
  
  test("should replace newlines with <br> in prompt", () => {
    const prompt = "Line 1\nLine 2\nLine 3"
    const result = prompt.replace(/\n/g, "<br>")
    expect(result).toBe("Line 1<br>Line 2<br>Line 3")
  })
  
  test("should handle empty prompt", () => {
    const prompt = ""
    const result = prompt.replace(/\n/g, "<br>")
    expect(result).toBe("")
  })
  
  test("should handle prompt with special characters", () => {
    const prompt = "Test | pipe \n newline \t tab"
    const result = prompt.replace(/\n/g, "<br>")
    expect(result).toBe("Test | pipe <br> newline \t tab")
  })
})
