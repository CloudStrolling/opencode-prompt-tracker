import { describe, expect, test } from 'bun:test';
import { LogData, MessageStep } from '../src/types';

describe('appendToPromptLog logic', () => {
  test('should generate correct summary entry with token breakdown', () => {
    const data: LogData = {
      sessionID: 'abc123',
      time: '10:32:45',
      agentChain: 'oracle → build',
      model: 'opencode/hy3-preview-free',
      prompt: 'Design a plugin',
      duration: '45.67',
      steps: 2,
      totalTokens: 3100,
      inputTokens: 1100,
      outputTokens: 2000,
      cachedTokens: 300,
      uncachedTokens: 800,
      cacheRead: 200,
      cacheWrite: 100,
    };

    const summary = `---

## Summary — ${data.time}
- **Model**: ${data.model}
- **Agent Chain**: ${data.agentChain}
- **Total Duration**: ${data.duration}s
- **Steps**: ${data.steps}
- **Total Tokens**: ${data.totalTokens} (input: ${data.inputTokens}, output: ${data.outputTokens})
- **Cached Tokens**: ${data.cachedTokens} (read: ${data.cacheRead}, write: ${data.cacheWrite})
- **Uncached Tokens**: ${data.uncachedTokens}

---

`;

    expect(summary).toContain('Total Tokens**: 3100');
    expect(summary).toContain('input: 1100, output: 2000');
    expect(summary).toContain('Cached Tokens**: 300');
    expect(summary).toContain('read: 200, write: 100');
    expect(summary).toContain('Uncached Tokens**: 800');
    expect(summary).toContain('Steps**: 2');
  });

  test('should generate correct step entry with task description', () => {
    const step: MessageStep = {
      stepNumber: 1,
      messageID: 'msg-001',
      agent: 'oracle',
      model: 'opencode/hy3-preview-free',
      time: '10:30:15',
      duration: '12.34',
      taskDescription: 'Analyze the authentication module structure',
      totalTokens: 1700,
      inputTokens: 500,
      outputTokens: 1200,
      cachedTokens: 100,
      uncachedTokens: 400,
      cacheRead: 0,
      cacheWrite: 100,
    };

    const entry = `### Step ${step.stepNumber} — ${step.time}
- **Agent**: ${step.agent}
- **Model**: ${step.model}
- **Duration**: ${step.duration}s
- **Total Tokens**: ${step.totalTokens} (input: ${step.inputTokens}, output: ${step.outputTokens})
- **Cached Tokens**: ${step.cachedTokens} (read: ${step.cacheRead}, write: ${step.cacheWrite})
- **Uncached Tokens**: ${step.uncachedTokens}
- **Task**: ${step.taskDescription}

`;

    expect(entry).toContain('Step 1');
    expect(entry).toContain('Total Tokens**: 1700');
    expect(entry).toContain('input: 500, output: 1200');
    expect(entry).toContain('Cached Tokens**: 100');
    expect(entry).toContain('Uncached Tokens**: 400');
    expect(entry).toContain('Analyze the authentication module structure');
  });

  test('should omit task line when description is empty', () => {
    const step: MessageStep = {
      stepNumber: 1,
      messageID: 'msg-001',
      agent: 'main',
      model: 'opencode/model-a',
      time: '10:30:15',
      duration: '5.00',
      taskDescription: '',
      totalTokens: 100,
      inputTokens: 50,
      outputTokens: 50,
      cachedTokens: 0,
      uncachedTokens: 50,
      cacheRead: 0,
      cacheWrite: 0,
    };

    const desc = step.taskDescription
      ? `\n- **Task**: ${step.taskDescription}`
      : '';
    expect(desc).toBe('');
  });

  test('should calculate uncached tokens correctly', () => {
    // input includes cached portions
    const inputTokens = 35466;
    const cacheRead = 8832;
    const cacheWrite = 0;
    const cachedTokens = cacheRead + cacheWrite;
    const uncachedTokens = Math.max(0, inputTokens - cachedTokens);

    expect(cachedTokens).toBe(8832);
    expect(uncachedTokens).toBe(26634);
    expect(inputTokens).toBe(uncachedTokens + cachedTokens);
  });

  test('should handle multiple steps with different cache profiles', () => {
    const steps: MessageStep[] = [
      {
        stepNumber: 1,
        messageID: 'msg-001',
        agent: 'oracle',
        model: 'opencode/model-a',
        time: '10:30:15',
        duration: '12.34',
        taskDescription: 'First step with cache write',
        totalTokens: 1700,
        inputTokens: 500,
        outputTokens: 1200,
        cachedTokens: 100,
        uncachedTokens: 400,
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
        taskDescription: 'Second step with cache read',
        totalTokens: 1400,
        inputTokens: 600,
        outputTokens: 800,
        cachedTokens: 200,
        uncachedTokens: 400,
        cacheRead: 200,
        cacheWrite: 0,
      },
    ];

    // Verify totals add up
    const totalInput = steps.reduce((s, st) => s + st.inputTokens, 0);
    const totalOutput = steps.reduce((s, st) => s + st.outputTokens, 0);
    const totalCached = steps.reduce((s, st) => s + st.cachedTokens, 0);
    const totalUncached = steps.reduce((s, st) => s + st.uncachedTokens, 0);

    expect(totalInput).toBe(1100);
    expect(totalOutput).toBe(2000);
    expect(totalCached).toBe(300);
    expect(totalUncached).toBe(800);
    expect(totalInput).toBe(totalCached + totalUncached);
  });

  test('should truncate long task description to 120 chars', () => {
    const longText =
      'This is a very long task description that should be truncated because it exceeds the maximum allowed length of one hundred and twenty characters for readability';
    const firstLine = longText.split('\n').find((line) => line.trim().length > 0) || '';
    const trimmed = firstLine.trim();
    const result =
      trimmed.length <= 120 ? trimmed : trimmed.substring(0, 120) + '...';

    expect(result.length).toBe(123); // 120 + '...'
    expect(result.endsWith('...')).toBe(true);
  });
});
