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
 * File Writer Utility
 * Handles writing conversation logs to Markdown files
 * Creates daily log files with structured format for easy reading
 *
 * Two types of log entries:
 * 1. Step log — written immediately when each assistant message completes
 * 2. Summary log — written when the entire session goes idle
 */

import type { LogData, MessageStep, SessionState, AllLogsData } from '../types';
import { logInfo, logError } from './logger';
import { formatCostLine } from './billing';

// Markdown header for new log files
const FILE_HEADER = `# Prompt-Tracker

`;

/**
 * Formats a single step entry into Markdown format
 * Written immediately when each assistant message completes
 */
function formatStepEntry(step: MessageStep): string {
  const desc = step.taskDescription ? `\n- **Task**: ${step.taskDescription}` : '';
  return `### Step ${step.stepNumber} — ${step.time}
- **Agent**: ${step.agent}
- **Model**: ${step.model}
- **Duration**: ${step.duration}s
- **Total Tokens**: ${step.totalTokens} (input: ${step.inputTokens}, output: ${step.outputTokens})
- **Cached Tokens**: ${step.cachedTokens} (read: ${step.cacheRead}, write: ${step.cacheWrite})
- **Uncached Tokens**: ${step.uncachedTokens}${desc}

`;
}

/**
 * Formats a summary entry into Markdown format
 * Written when session.idle fires, after all step logs
 */
function formatSummaryEntry(data: LogData): string {
  let costLine = '';
  if (data.costBreakdown) {
    costLine = `\n- ${formatCostLine(data.costBreakdown)}`;
  }

  return `---

### Summary — From ${data.time} To ${data.endTime}
- **Model**: ${data.model}
- **Agent Chain**: ${data.agentChain}
- **Total Duration**: ${data.duration}s
- **Steps**: ${data.steps}
- **Total Tokens**: ${data.totalTokens} (input: ${data.inputTokens}, output: ${data.outputTokens})
- **Cached Tokens**: ${data.cachedTokens} (read: ${data.cacheRead}, write: ${data.cacheWrite})
- **Uncached Tokens**: ${data.uncachedTokens}${costLine}

---

`;
}

/**
 * Ensures the prompts directory exists
 * Supports both Bun and Node.js runtimes
 */
async function ensureDirectory(promptsDir: string): Promise<void> {
  if (typeof Bun !== 'undefined') {
    try {
      // Use spawn to create directory (mkdir -p creates parent dirs too)
      await Bun.spawn(['mkdir', '-p', promptsDir], { stderr: 'pipe' });
    } catch (e) {
      // Fallback: try writing to ensure directory exists
      try {
        await Bun.write(`${promptsDir}/.placeholder`, '', { createPath: true });
        // Delete the placeholder file after directory exists
        await Bun.file(`${promptsDir}/.placeholder`).delete().catch(() => {});
      } catch (writeError) {
        await logError('Failed to create directory', {
          dir: promptsDir,
          error: String(writeError),
        });
      }
    }
  } else {
    const fs = await import('fs');
    if (!fs.existsSync(promptsDir)) {
      fs.mkdirSync(promptsDir, { recursive: true });
    }
  }
}

/**
 * Builds the file path for a session's log file
 * Uses config values for outputPath and filePrefix
 */
function buildFilePath(
  directory: string,
  sessionID: string,
  dateStr: string,
  outputPath: string,
  filePrefix: string
): {
  fileName: string;
  filePath: string;
  promptsDir: string;
} {
  const fileName = `${filePrefix}${dateStr}_${sessionID}.md`;
  const promptsDir = `${directory}/${outputPath}`;
  const filePath = `${promptsDir}/${fileName}`;
  return { fileName, filePath, promptsDir };
}

/**
 * Appends a step log entry to the Markdown file
 * Called immediately when each assistant message completes
 * Creates the file with header + prompt if this is the first step
 */
export async function appendStepToPromptRecorder(
  directory: string,
  sessionID: string,
  sessionStartTime: string,
  step: MessageStep,
  isFirstStep: boolean,
  prompt: string,
  outputPath: string,
  filePrefix: string
): Promise<void> {
  const dateStr = sessionStartTime.substring(0, 10);
  const { fileName, filePath, promptsDir } = buildFilePath(
    directory,
    sessionID,
    dateStr,
    outputPath,
    filePrefix
  );
  const entry = formatStepEntry(step);

  // On first step, prepend prompt section after header
  let prependSection = '';
  if (isFirstStep) {
    prependSection = `## Prompt\n${prompt}\n\n`;
  }

  try {
    await ensureDirectory(promptsDir);

    if (typeof Bun !== 'undefined') {
      const file = Bun.file(filePath);
      const fileExists = await file.exists();

      let existingContent = '';
      if (fileExists) {
        existingContent = await file.text();
      }

      const content = (fileExists ? existingContent : FILE_HEADER) + prependSection + entry;
      await Bun.write(filePath, content);
    } else {
      const fs = await import('fs');
      const headerIfNeeded = !fs.existsSync(filePath) ? FILE_HEADER : '';
      fs.appendFileSync(filePath, headerIfNeeded + prependSection + entry, 'utf8');
    }

    await logInfo('Logged step', {
      file: fileName,
      sessionID,
      step: step.stepNumber,
      agent: step.agent,
      totalTokens: step.totalTokens,
    });
  } catch (error) {
    await logError('Failed to write step log', { file: fileName, error: String(error) });
    throw error;
  }
}

/**
 * Appends a summary log entry to the Markdown file
 * Called when session.idle fires, after all step logs have been written
 */
export async function appendToPromptRecorder(
  directory: string,
  data: LogData,
  sessionState: SessionState,
  outputPath: string,
  filePrefix: string
): Promise<void> {
  const dateStr = sessionState.sessionStartTime.substring(0, 10);
  const { fileName, filePath, promptsDir } = buildFilePath(
    directory,
    data.sessionID,
    dateStr,
    outputPath,
    filePrefix
  );
  const entry = formatSummaryEntry(data);

  try {
    await ensureDirectory(promptsDir);

    if (typeof Bun !== 'undefined') {
      const file = Bun.file(filePath);
      const fileExists = await file.exists();

      let existingContent = '';
      if (fileExists) {
        existingContent = await file.text();
      }

      const content = (fileExists ? existingContent : FILE_HEADER) + entry;
      await Bun.write(filePath, content);
    } else {
      const fs = await import('fs');
      const headerIfNeeded = !fs.existsSync(filePath) ? FILE_HEADER : '';
      fs.appendFileSync(filePath, headerIfNeeded + entry, 'utf8');
    }

    await logInfo('Logged summary', {
      file: fileName,
      sessionID: data.sessionID,
      steps: data.steps,
      totalTokens: data.totalTokens,
      duration: data.duration,
    });
  } catch (error) {
    await logError('Failed to write summary log', { file: fileName, error: String(error) });
  }
}

/**
 * Formats the complete all-logs file content
 * Written once when session.idle fires
 */
function formatAllLogsEntry(data: AllLogsData): string {
  const lines: string[] = [
    '# All Logs',
    '',
    `## Session: ${data.sessionID}`,
    `**Start:** ${data.startTime} | **End:** ${data.endTime}`,
    '',
    '---',
    '',
  ];

  const maxCount = Math.max(
    data.userInputs.length,
    data.assistantOutputs.length
  );

  for (let i = 0; i < maxCount; i++) {
    // User input
    const userInput = data.userInputs[i];
    const userTime = data.userInputTimes[i] || '';

    if (userInput) {
      lines.push(`### User Input #${i + 1}${userTime ? ` — ${userTime}` : ''}`);
      lines.push('');
      lines.push('```');
      lines.push(userInput);
      lines.push('```');
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    // Assistant output (includes thinking + response)
    const assistantOutput = data.assistantOutputs[i];
    const assistantTime = data.assistantOutputTimes[i] || '';

    if (assistantOutput) {
      lines.push(`### Assistant Output #${i + 1}${assistantTime ? ` — ${assistantTime}` : ''}`);
      lines.push('');
      lines.push('```');
      lines.push(assistantOutput);
      lines.push('```');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Writes the complete all-logs file capturing full conversation
 * Called once when session.idle fires if saveAllLogs is enabled
 */
export async function appendAllLogsToPromptRecorder(
  directory: string,
  sessionID: string,
  sessionStartTime: string,
  data: AllLogsData,
  outputPath: string
): Promise<void> {
  const dateStr = sessionStartTime.substring(0, 10);
  const logPrefix = 'opencode-prompt-log-';
  const fileName = `${logPrefix}${dateStr}_${sessionID}.md`;
  const promptsDir = `${directory}/${outputPath}`;
  const filePath = `${promptsDir}/${fileName}`;

  const content = formatAllLogsEntry(data);

  try {
    await ensureDirectory(promptsDir);

    if (typeof Bun !== 'undefined') {
      await Bun.write(filePath, content);
    } else {
      const fs = await import('fs');
      if (!fs.existsSync(promptsDir)) {
        fs.mkdirSync(promptsDir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf8');
    }

    await logInfo('Logged all conversation', {
      file: fileName,
      sessionID,
      userInputCount: data.userInputs.length,
      assistantOutputCount: data.assistantOutputs.length,
    });
  } catch (error) {
    await logError('Failed to write all-logs file', { file: fileName, error: String(error) });
  }
}
