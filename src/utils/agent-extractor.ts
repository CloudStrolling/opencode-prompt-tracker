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

/**
 * Agent Chain Extractor Utility
 * Parses OpenCode message parts to extract agent call chain information
 * Used to track which agents were involved in processing a conversation
 */

/**
 * Extracts agent names from message parts array
 * Searches for agent and subtask part types to build the call chain
 *
 * @param parts - Array of message parts from OpenCode message structure
 * @returns Array of agent names in order of appearance
 *
 * @example
 * // Given parts with agent calls:
 * // [{ type: 'agent', name: 'oracle' }, { type: 'subtask', agent: 'build' }]
 * // Returns: ['oracle', 'build']
 */
export function extractAgentChain(parts: any[]): string[] {
  const agents: string[] = [];

  // Iterate through all parts to find agent references
  for (const part of parts) {
    // Direct agent invocation: { type: 'agent', name: 'agentName' }
    if (part.type === 'agent' && part.name) {
      agents.push(part.name);
    }
    // Sub-task invoked through another agent: { type: 'subtask', agent: 'agentName' }
    else if (part.type === 'subtask' && part.agent) {
      agents.push(part.agent);
    }
  }

  return agents;
}
