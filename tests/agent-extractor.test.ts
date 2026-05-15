/*
 * Copyright 2026 jenemy8023<jenemy8023@163.com>
 *
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
