/**
 * File Writer Utility
 * Handles writing conversation logs to Markdown files
 * Creates daily log files with structured format for easy reading
 *
 * Two types of log entries:
 * 1. Step log — written immediately when each assistant message completes
 * 2. Summary log — written when the entire session goes idle
 */

import type { LogData, MessageStep, SessionState } from '../types';
import { logInfo, logError } from './logger';

// Markdown header for new log files
const FILE_HEADER = `# Prompt Log - Session

`;

/**
 * Formats a single step entry into Markdown format
 * Written immediately when each assistant message completes
 *
 * @param step - MessageStep containing step details
 * @returns Formatted Markdown string for the step entry
 */
function formatStepEntry(step: MessageStep): string {
  return `### Step ${step.stepNumber} — ${step.time}
- **Agent**: ${step.agent}
- **Model**: ${step.model}
- **Duration**: ${step.duration}s
- **Input Tokens**: ${step.inputTokens}
- **Output Tokens**: ${step.outputTokens}
- **Cache Read**: ${step.cacheRead}
- **Cache Write**: ${step.cacheWrite}

`;
}

/**
 * Formats a summary entry into Markdown format
 * Written when session.idle fires, after all step logs
 *
 * @param data - LogData containing session summary
 * @returns Formatted Markdown string for the summary entry
 */
function formatSummaryEntry(data: LogData): string {
  return `---

## Summary — ${data.time}
- **Model**: ${data.model}
- **Agent Chain**: ${data.agentChain}
- **Total Duration**: ${data.duration}s
- **Steps**: ${data.steps}
- **Total Input Tokens**: ${data.inputTokens}
- **Total Output Tokens**: ${data.outputTokens}
- **Total Cache Read**: ${data.cacheRead}
- **Total Cache Write**: ${data.cacheWrite}

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
      await Bun.write(`${promptsDir}/.keep`, '', { createPath: true });
    } catch (e) {
      try {
        await Bun.spawn(['mkdir', '-p', promptsDir], { stderr: 'pipe' });
      } catch (spawnError) {
        await logError('Failed to create directory', {
          dir: promptsDir,
          error: String(spawnError),
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
 */
function buildFilePath(directory: string, sessionID: string, dateStr: string): {
  fileName: string;
  filePath: string;
  promptsDir: string;
} {
  const fileName = `opencode-prompt-${dateStr}_${sessionID}.md`;
  const promptsDir = `${directory}/.opencode/prompts`;
  const filePath = `${promptsDir}/${fileName}`;
  return { fileName, filePath, promptsDir };
}

/**
 * Appends a step log entry to the Markdown file
 * Called immediately when each assistant message completes
 * Creates the file with header + prompt if this is the first step
 *
 * @param directory - Project root directory
 * @param sessionID - Session identifier
 * @param sessionStartTime - Date string (YYYY-MM-DD) for file naming
 * @param step - MessageStep data for the completed assistant message
 * @param isFirstStep - Whether this is the first step (writes header + prompt)
 * @param prompt - User's original prompt text (used only on first step)
 */
export async function appendStepToPromptLog(
  directory: string,
  sessionID: string,
  sessionStartTime: string,
  step: MessageStep,
  isFirstStep: boolean,
  prompt: string
): Promise<void> {
  const dateStr = sessionStartTime.substring(0, 10);
  const { fileName, filePath, promptsDir } = buildFilePath(directory, sessionID, dateStr);
  const entry = formatStepEntry(step);

  // On first step, prepend prompt section after header
  const promptSection = isFirstStep ? `### Prompt\n${prompt}\n\n` : '';

  try {
    await ensureDirectory(promptsDir);

    if (typeof Bun !== 'undefined') {
      const file = Bun.file(filePath);
      const fileExists = await file.exists();

      let existingContent = '';
      if (fileExists) {
        existingContent = await file.text();
      }

      // First step: write header + prompt + step entry; subsequent steps: append only
      const content = (fileExists ? existingContent : FILE_HEADER) + promptSection + entry;
      await Bun.write(filePath, content);
    } else {
      const fs = await import('fs');
      const headerIfNeeded = !fs.existsSync(filePath) ? FILE_HEADER : '';
      fs.appendFileSync(filePath, headerIfNeeded + promptSection + entry, 'utf8');
    }

    await logInfo('Logged step', {
      file: fileName,
      sessionID,
      step: step.stepNumber,
      agent: step.agent,
      model: step.model,
      inputTokens: step.inputTokens,
      outputTokens: step.outputTokens,
    });
  } catch (error) {
    await logError('Failed to write step log', { file: fileName, error: String(error) });
    throw error;
  }
}

/**
 * Appends a summary log entry to the Markdown file
 * Called when session.idle fires, after all step logs have been written
 *
 * @param directory - Project root directory
 * @param data - LogData for the completed session summary
 * @param sessionState - SessionState containing metadata from conversation start
 */
export async function appendToPromptLog(
  directory: string,
  data: LogData,
  sessionState: SessionState
): Promise<void> {
  const dateStr = sessionState.sessionStartTime.substring(0, 10);
  const { fileName, filePath, promptsDir } = buildFilePath(directory, data.sessionID, dateStr);
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
      duration: data.duration,
      steps: data.steps,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
    });
  } catch (error) {
    await logError('Failed to write summary log', { file: fileName, error: String(error) });
    throw error;
  }
}
