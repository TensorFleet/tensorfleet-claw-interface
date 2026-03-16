/**
 * Global logger for Tensorfleet Claw Interface
 * Tags all logs with [Tensorfleet][Openclaw] prefix
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private prefix = '[Tensorfleet][Openclaw]';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    return `${this.prefix} [${timestamp}] ${level}: ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(this.formatMessage('DEBUG', message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.info(this.formatMessage('INFO', message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', message), ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', message), ...args);
    }
  }
}

// Create and export singleton instance
export const logger = new Logger();

// Export convenience functions
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);