import { describe, expect, test } from 'bun:test';
import { extractAgentChain } from '../src/utils/agent-extractor';

describe('extractAgentChain', () => {
  test('should extract agent from parts with agent type', () => {
    const parts = [
      { type: 'text', text: 'Hello' },
      { type: 'agent', name: 'oracle' },
      { type: 'tool', tool: 'bash' },
    ];

    const result = extractAgentChain(parts);
    expect(result).toEqual(['oracle']);
  });

  test('should extract multiple agents from parts', () => {
    const parts = [
      { type: 'agent', name: 'oracle' },
      { type: 'subtask', agent: 'build', prompt: 'Do something' },
      { type: 'agent', name: 'explore' },
    ];

    const result = extractAgentChain(parts);
    expect(result).toEqual(['oracle', 'build', 'explore']);
  });

  test('should return empty array if no agent parts', () => {
    const parts = [
      { type: 'text', text: 'Hello' },
      { type: 'tool', tool: 'bash' },
    ];

    const result = extractAgentChain(parts);
    expect(result).toEqual([]);
  });

  test('should handle subtask without agent field', () => {
    const parts = [{ type: 'subtask', prompt: 'Do something' }];

    const result = extractAgentChain(parts);
    expect(result).toEqual([]);
  });

  test('should handle empty parts array', () => {
    const result = extractAgentChain([]);
    expect(result).toEqual([]);
  });

  test('should extract nested agent chains correctly', () => {
    const parts = [
      { type: 'agent', name: 'main' },
      { type: 'subtask', agent: 'code-review', prompt: 'Review code' },
      { type: 'subtask', agent: 'test', prompt: 'Run tests' },
      { type: 'agent', name: 'main' },
    ];

    const result = extractAgentChain(parts);
    expect(result).toEqual(['main', 'code-review', 'test', 'main']);
  });
});
