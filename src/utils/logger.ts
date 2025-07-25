/**
 * Logger utility for Scout application
 * 
 * Provides structured logging with different levels and conditional output
 * based on environment. Replaces direct console.* calls throughout the app.
 */

// Log levels in order of severity
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// Logger configuration
interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableTimestamps: boolean;
  prefix?: string;
}

// Default configuration
const DEFAULT_CONFIG: LoggerConfig = {
  level: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.WARN,
  enableConsole: true,
  enableTimestamps: true,
  prefix: '[Scout]',
};

class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level && this.config.enableConsole;
  }

  /**
   * Format log message with timestamp and prefix
   */
  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): [string, ...unknown[]] {
    const timestamp = this.config.enableTimestamps 
      ? new Date().toISOString().split('T')[1].split('.')[0] // HH:MM:SS format
      : '';
    
    const levelName = LogLevel[level].padEnd(5);
    const prefix = this.config.prefix || '';
    
    const formattedMessage = [
      timestamp && `[${timestamp}]`,
      prefix,
      `[${levelName}]`,
      message
    ].filter(Boolean).join(' ');

    return [formattedMessage, ...args];
  }

  /**
   * Debug level logging - detailed information for debugging
   * Only shown in development
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const [formattedMessage, ...formattedArgs] = this.formatMessage(LogLevel.DEBUG, message, ...args);
      console.log(formattedMessage, ...formattedArgs);
    }
  }

  /**
   * Info level logging - general information
   */
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const [formattedMessage, ...formattedArgs] = this.formatMessage(LogLevel.INFO, message, ...args);
      console.info(formattedMessage, ...formattedArgs);
    }
  }

  /**
   * Warning level logging - potential issues
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const [formattedMessage, ...formattedArgs] = this.formatMessage(LogLevel.WARN, message, ...args);
      console.warn(formattedMessage, ...formattedArgs);
    }
  }

  /**
   * Error level logging - errors and exceptions
   */
  error(message: string, error?: Error | unknown, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const [formattedMessage, ...formattedArgs] = this.formatMessage(
        LogLevel.ERROR, 
        message, 
        error, 
        ...args
      );
      console.error(formattedMessage, ...formattedArgs);
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(prefix: string): Logger {
    const childPrefix = this.config.prefix 
      ? `${this.config.prefix}:${prefix}`
      : `[${prefix}]`;
    
    return new Logger({ 
      ...this.config, 
      prefix: childPrefix 
    });
  }

  /**
   * Group related log messages
   */
  group(label: string, callback: () => void): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.group(label);
      try {
        callback();
      } finally {
        console.groupEnd();
      }
    } else {
      callback();
    }
  }

  /**
   * Time a function execution
   */
  time<T>(label: string, fn: () => T): T {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.time(label);
      try {
        return fn();
      } finally {
        console.timeEnd(label);
      }
    } else {
      return fn();
    }
  }

  /**
   * Time an async function execution
   */
  async timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.time(label);
      try {
        return await fn();
      } finally {
        console.timeEnd(label);
      }
    } else {
      return await fn();
    }
  }
}

// Create default logger instance
export const logger = new Logger();

// Create domain-specific loggers
export const loggers = {
  audio: logger.child('Audio'),
  recording: logger.child('Recording'),
  transcription: logger.child('Transcription'),
  ui: logger.child('UI'),
  api: logger.child('API'),
  settings: logger.child('Settings'),
  performance: logger.child('Performance'),
};

// Convenience function to create custom loggers
export const createLogger = (name: string): Logger => logger.child(name);

// Production-safe assertion that logs errors instead of throwing
export const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    logger.error(`Assertion failed: ${message}`);
    if (process.env.NODE_ENV === 'development') {
      throw new Error(`Assertion failed: ${message}`);
    }
  }
};

// Legacy console replacement - use sparingly for migration
export const console_log = logger.debug.bind(logger);
export const console_info = logger.info.bind(logger);
export const console_warn = logger.warn.bind(logger);
export const console_error = logger.error.bind(logger);
