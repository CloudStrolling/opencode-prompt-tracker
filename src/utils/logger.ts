/**
 * Logger utility for the Prompt Recorder Plugin
 * Provides both OpenCode client logging and file-based fallback logging
 */

import type { LogData } from '../types';

// Global references to OpenCode client and file path
// Initialized during plugin setup
let clientRef: any = null;
let logFilePath: string = '';

/**
 * Initializes the logger with OpenCode client and working directory
 * Called once during plugin activation
 *
 * @param client - OpenCode client instance for console logging
 * @param directory - Project directory path for log file location
 */
export function initLogger(client: any, directory: string) {
  clientRef = client;
  logFilePath = `${directory}/.opencode/prompts/.plugin-log`;
}

/**
 * Writes a log entry to the fallback file
 * Used when OpenCode client logging is unavailable
 *
 * @param level - Log level (INFO, ERROR, WARN, etc.)
 * @param message - Main log message
 * @param extra - Optional additional data to serialize as JSON
 */
async function writeToFile(level: string, message: string, extra?: any) {
  try {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}${extra ? ' ' + JSON.stringify(extra) : ''}\n`;

    // Check if running in Bun runtime
    if (typeof Bun !== 'undefined') {
      const file = Bun.file(logFilePath);
      const existing = (await file.exists()) ? await file.text() : '';
      await Bun.write(logFilePath, existing + line);
    } else {
      // Fallback to Node.js fs module
      const fs = await import('fs');
      fs.appendFileSync(logFilePath, line, 'utf8');
    }
  } catch {
    // Silent fail - logging should not break plugin functionality
  }
}

/**
 * Logs an info-level message
 * Attempts OpenCode client logging first, falls back to file logging
 *
 * @param message - Log message text
 * @param extra - Optional metadata object to include in log
 */
export async function logInfo(message: string, extra?: any) {
  // Priority: Use OpenCode's client.app.log for console output
  if (clientRef?.app?.log) {
    try {
      await clientRef.app.log({
        body: {
          service: 'prompt-log',
          level: 'info',
          message,
          extra: extra || {},
        },
      });
      return;
    } catch {
      // Fallback to file logging if client.log fails
    }
  }
  await writeToFile('INFO', message, extra);
}

/**
 * Logs an error-level message
 * Attempts OpenCode client logging first, falls back to file logging
 *
 * @param message - Error message text
 * @param extra - Optional metadata object to include in log
 */
export async function logError(message: string, extra?: any) {
  if (clientRef?.app?.log) {
    try {
      await clientRef.app.log({
        body: {
          service: 'prompt-log',
          level: 'error',
          message,
          extra: extra || {},
        },
      });
      return;
    } catch {
      // Fallback to file logging if client.log fails
    }
  }
  await writeToFile('ERROR', message, extra);
}
