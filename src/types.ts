/**
 * Type definitions for the OpenCode Prompt Log Plugin
 * Defines data structures used for tracking conversation metadata and logging
 */

/**
 * Represents the state of a conversation session
 * Captured when user sends a message, stored until assistant response completes
 */
export interface SessionState {
  /** Unique identifier for the user's message in this session */
  userMsgID: string;
  /** The prompt/input text from the user */
  prompt: string;
  /** AI model identifier (e.g., 'opencode/hy3-preview-free') */
  model: string;
  /** Unix timestamp (ms) when the session started */
  startTime: number;
  /** Array of agent names representing the call chain (e.g., ['main', 'oracle', 'build']) */
  agentChain: string[];
  /** Date string in 'YYYY-MM-DD' format, used for file naming */
  sessionStartTime: string;
}

/**
 * Represents the complete log entry data for a completed conversation
 * Used when writing to the Markdown log file
 */
export interface LogData {
  /** Unique session identifier */
  sessionID: string;
  /** Formatted time string (HH:MM:SS) when conversation started */
  time: string;
  /** Agent call chain as arrow-separated string (e.g., 'oracle → build → explore') */
  agentChain: string;
  /** AI model identifier used for this conversation */
  model: string;
  /** User's original prompt text */
  prompt: string;
  /** Duration of conversation processing in seconds (fixed to 2 decimal places) */
  duration: string;
  /** Number of input tokens consumed */
  inputTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
  /** Number of context tokens (from total input) */
  contextTokens: number;
  /** Number of tokens read from cache */
  cacheRead: number;
  /** Number of tokens written to cache */
  cacheWrite: number;
}
