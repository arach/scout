/**
 * Console Migration Helper
 * 
 * Temporary helper for migrating console.* calls to the new logger.
 * This file should be removed after migration is complete.
 */

import { loggers } from './logger';

/**
 * Drop-in replacements for console methods during migration
 * Usage: Replace `console.log` with `migrationConsole.log` etc.
 */
export const migrationConsole = {
  log: (message: string, ...args: unknown[]) => {
    loggers.ui.debug(message, ...args);
  },
  
  info: (message: string, ...args: unknown[]) => {
    loggers.ui.info(message, ...args);
  },
  
  warn: (message: string, ...args: unknown[]) => {
    loggers.ui.warn(message, ...args);
  },
  
  error: (message: string, ...args: unknown[]) => {
    loggers.ui.error(message, ...args);
  },
};

/**
 * Domain-specific console replacements
 */
export const domainConsole = {
  audio: {
    log: loggers.audio.debug.bind(loggers.audio),
    info: loggers.audio.info.bind(loggers.audio),
    warn: loggers.audio.warn.bind(loggers.audio),
    error: loggers.audio.error.bind(loggers.audio),
  },
  
  recording: {
    log: loggers.recording.debug.bind(loggers.recording),
    info: loggers.recording.info.bind(loggers.recording),
    warn: loggers.recording.warn.bind(loggers.recording),
    error: loggers.recording.error.bind(loggers.recording),
  },
  
  api: {
    log: loggers.api.debug.bind(loggers.api),
    info: loggers.api.info.bind(loggers.api),
    warn: loggers.api.warn.bind(loggers.api),
    error: loggers.api.error.bind(loggers.api),
  },
  
  transcription: {
    log: loggers.transcription.debug.bind(loggers.transcription),
    info: loggers.transcription.info.bind(loggers.transcription),
    warn: loggers.transcription.warn.bind(loggers.transcription),
    error: loggers.transcription.error.bind(loggers.transcription),
  },
};

/**
 * Quick migration function for common patterns
 */
export const migrateConsoleCall = (
  originalCall: string,
  domain: keyof typeof domainConsole = 'audio'
): string => {
  // Basic pattern matching and replacement suggestions
  if (originalCall.includes('console.log')) {
    return originalCall.replace('console.log', `domainConsole.${domain}.log`);
  }
  if (originalCall.includes('console.error')) {
    return originalCall.replace('console.error', `domainConsole.${domain}.error`);
  }
  if (originalCall.includes('console.warn')) {
    return originalCall.replace('console.warn', `domainConsole.${domain}.warn`);
  }
  if (originalCall.includes('console.info')) {
    return originalCall.replace('console.info', `domainConsole.${domain}.info`);
  }
  
  return originalCall;
};
