/**
 * Global logger for Tensorfleet Claw Interface using pino
 * Tags all logs with [Tensorfleet][Openclaw] prefix
 */

import pino from 'pino';

// Create pino logger with custom format
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { pid: undefined, hostname: undefined },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
    log: (object) => {
      // Add custom prefix to the message
      if (object.msg) {
        object.msg = `[Tensorfleet][Openclaw] ${object.msg}`;
      }
      return object;
    }
  }
});

// Export convenience functions that match the original API
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);

// Export the logger instance for advanced usage
export { logger };

// Export LogLevel enum for compatibility
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  SILENT = 'silent'
}

// Compatibility method to set log level
export function setLogLevel(level: LogLevel): void {
  logger.level = level;
}