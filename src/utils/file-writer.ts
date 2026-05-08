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
import { formatCostLine } from './billing';

// Markdown header for new log files
const FILE_HEADER = `# Prompt Recorder - Session

`;

/**
 * Formats a single step entry into Markdown format
 * Written immediately when each assistant message completes
 */
function formatStepEntry(step: MessageStep): string {
  const desc = step.taskDescription
    ? `\n- **Task**: ${step.taskDescription}`
    : '';
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

## Summary — ${data.time}
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
    throw error;
  }
}
