/**
 * File Writer Utility
 * Handles writing conversation logs to Markdown files
 * Creates daily log files with structured format for easy reading
 */

import type { LogData, SessionState } from '../types';
import { logInfo, logError } from './logger';

// Markdown header for new log files
// Added only when creating a new file (first entry)
const FILE_HEADER = `# Prompt Log - Session

`;

/**
 * Formats a log data entry into Markdown format
 * Creates a section with metadata and the user's prompt
 *
 * @param data - LogData containing conversation details
 * @returns Formatted Markdown string for the log entry
 *
 * @example
 * // Output format:
 * // ## 10:30:15
 * // - **Model**: opencode/hy3-preview-free
 * // - **Agent Chain**: oracle → build
 * // - **Duration**: 12.34s
 * // - **Input Tokens**: 150
 * // ...
 */
function formatLogEntry(data: LogData): string {
  return `## ${data.time}

- **Model**: ${data.model}
- **Agent Chain**: ${data.agentChain}
- **Duration**: ${data.duration}s
- **Input Tokens**: ${data.inputTokens}
- **Output Tokens**: ${data.outputTokens}
- **Context Tokens**: ${data.contextTokens}
- **Cache Read**: ${data.cacheRead}
- **Cache Write**: ${data.cacheWrite}

### Prompt
${data.prompt}

---

`;
}

/**
 * Appends a conversation log entry to the Markdown file
 * Creates the prompts directory and file if they don't exist
 * Supports both Bun and Node.js runtimes
 *
 * @param directory - Project root directory
 * @param data - LogData for the completed conversation
 * @param sessionState - SessionState containing metadata from conversation start
 *
 * @throws Error if file write fails
 *
 * @remarks
 * - File naming: opencode-prompt-YYYY-MM-DD_<sessionID>.md
 * - Multiple turns in same session append to the same file
 * - First entry in file includes FILE_HEADER
 */
export async function appendToPromptLog(
  directory: string,
  data: LogData,
  sessionState: SessionState
): Promise<void> {
  // Extract date from session start time (first 10 chars: YYYY-MM-DD)
  const dateStr = sessionState.sessionStartTime.substring(0, 10);
  // Construct filename: opencode-prompt-2024-01-15_abc123.md
  const fileName = `opencode-prompt-${dateStr}_${data.sessionID}.md`;
  const promptsDir = `${directory}/.opencode/prompts`;
  const filePath = `${promptsDir}/${fileName}`;

  const entry = formatLogEntry(data);

  try {
    // Check if running in Bun runtime (Bun.env is defined)
    if (typeof Bun !== 'undefined') {
      try {
        // Create .keep file to ensure directory exists in git
        await Bun.write(`${promptsDir}/.keep`, '', { createPath: true });
      } catch (e) {
        // Fallback: use mkdir command
        try {
          await Bun.spawn(['mkdir', '-p', promptsDir], { stderr: 'pipe' });
        } catch (spawnError) {
          await logError('Failed to create directory', {
            dir: promptsDir,
            error: String(spawnError),
          });
        }
      }

      // Read existing file content if it exists
      const file = Bun.file(filePath);
      const fileExists = await file.exists();

      let existingContent = '';
      if (fileExists) {
        existingContent = await file.text();
      }

      // Prepend header if new file, otherwise just append entry
      const content = (fileExists ? existingContent : FILE_HEADER) + entry;
      await Bun.write(filePath, content);
    } else {
      // Node.js runtime fallback
      const fs = await import('fs');

      // Ensure prompts directory exists
      if (!fs.existsSync(promptsDir)) {
        fs.mkdirSync(promptsDir, { recursive: true });
      }

      // Add header only for new files
      const headerIfNeeded = !fs.existsSync(filePath) ? FILE_HEADER : '';
      fs.appendFileSync(filePath, headerIfNeeded + entry, 'utf8');
    }

    await logInfo('Logged prompt', {
      file: fileName,
      sessionID: data.sessionID,
      duration: data.duration,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
    });
  } catch (error) {
    await logError('Failed to write log', { file: fileName, error: String(error) });
    throw error;
  }
}
