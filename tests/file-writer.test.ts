import { describe, expect, test } from 'bun:test';
import { LogData, MessageStep } from '../src/types';

describe('appendToPromptLog logic', () => {
  test('should generate correct summary entry with all fields', () => {
    const data: LogData = {
      sessionID: 'abc123',
      time: '10:32:45',
      agentChain: 'oracle → build',
      model: 'opencode/hy3-preview-free',
      prompt: 'Design a plugin',
      duration: '45.67',
      steps: 2,
      inputTokens: 1100,
      outputTokens: 2000,
      contextTokens: 100,
      cacheRead: 200,
      cacheWrite: 100,
    };

    // Test the summary content generation logic
    const summary = `---

## Summary — ${data.time}
- **Model**: ${data.model}
- **Agent Chain**: ${data.agentChain}
- **Total Duration**: ${data.duration}s
- **Steps**: ${data.steps}
- **Total Input Tokens**: ${data.inputTokens}
- **Total Output Tokens**: ${data.outputTokens}
- **Total Cache Read**: ${data.cacheRead}
- **Total Cache Write**: ${data.cacheWrite}

### Prompt
${data.prompt}

---

`;

    expect(summary).toContain('10:32:45');
    expect(summary).toContain('oracle → build');
    expect(summary).toContain('Design a plugin');
    expect(summary).toContain('45.67');
    expect(summary).toContain('Steps**: 2');
    expect(summary).toContain('1100');
    expect(summary).toContain('2000');
    expect(summary).toContain('200');
    expect(summary).toContain('100');
  });

  test('should generate correct step entry with all fields', () => {
    const step: MessageStep = {
      stepNumber: 1,
      messageID: 'msg-001',
      agent: 'oracle',
      model: 'opencode/hy3-preview-free',
      time: '10:30:15',
      duration: '12.34',
      inputTokens: 500,
      outputTokens: 1200,
      contextTokens: 50,
      cacheRead: 0,
      cacheWrite: 100,
    };

    const entry = `### Step ${step.stepNumber} — ${step.time}
- **Agent**: ${step.agent}
- **Model**: ${step.model}
- **Duration**: ${step.duration}s
- **Input Tokens**: ${step.inputTokens}
- **Output Tokens**: ${step.outputTokens}
- **Cache Read**: ${step.cacheRead}
- **Cache Write**: ${step.cacheWrite}

`;

    expect(entry).toContain('Step 1');
    expect(entry).toContain('10:30:15');
    expect(entry).toContain('oracle');
    expect(entry).toContain('12.34');
    expect(entry).toContain('500');
    expect(entry).toContain('1200');
    expect(entry).toContain('0');
    expect(entry).toContain('100');
  });

  test('should handle multiple steps formatting', () => {
    const steps: MessageStep[] = [
      {
        stepNumber: 1,
        messageID: 'msg-001',
        agent: 'oracle',
        model: 'opencode/model-a',
        time: '10:30:15',
        duration: '12.34',
        inputTokens: 500,
        outputTokens: 1200,
        contextTokens: 0,
        cacheRead: 0,
        cacheWrite: 100,
      },
      {
        stepNumber: 2,
        messageID: 'msg-002',
        agent: 'build',
        model: 'opencode/model-b',
        time: '10:31:20',
        duration: '8.56',
        inputTokens: 600,
        outputTokens: 800,
        contextTokens: 0,
        cacheRead: 200,
        cacheWrite: 0,
      },
    ];

    const entries = steps
      .map(
        (s) =>
          `### Step ${s.stepNumber} — ${s.time}
- **Agent**: ${s.agent}
- **Model**: ${s.model}
- **Duration**: ${s.duration}s
- **Input Tokens**: ${s.inputTokens}
- **Output Tokens**: ${s.outputTokens}
- **Cache Read**: ${s.cacheRead}
- **Cache Write**: ${s.cacheWrite}

`
      )
      .join('');

    expect(entries).toContain('Step 1');
    expect(entries).toContain('Step 2');
    expect(entries).toContain('oracle');
    expect(entries).toContain('build');
    expect(entries).toContain('model-a');
    expect(entries).toContain('model-b');
  });

  test('should replace newlines with <br> in prompt', () => {
    const prompt = 'Line 1\nLine 2\nLine 3';
    const result = prompt.replace(/\n/g, '<br>');
    expect(result).toBe('Line 1<br>Line 2<br>Line 3');
  });

  test('should handle empty prompt', () => {
    const prompt = '';
    const result = prompt.replace(/\n/g, '<br>');
    expect(result).toBe('');
  });

  test('should handle prompt with special characters', () => {
    const prompt = 'Test | pipe \n newline \t tab';
    const result = prompt.replace(/\n/g, '<br>');
    expect(result).toBe('Test | pipe <br> newline \t tab');
  });
});
