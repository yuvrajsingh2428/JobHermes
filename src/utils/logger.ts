// ============================================================
// Logger Utility – Structured, leveled logging with file output
// ============================================================

import fs from 'fs';
import path from 'path';
import { LogEntry } from '../types';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

class Logger {
  private logLevel: LogLevel;
  private logDir: string;
  private currentLogFile: string;

  constructor() {
    this.logLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.logDir = process.env.LOG_DIR || './logs';
    this.currentLogFile = this.getLogFilePath();
    this.ensureLogDir();
  }

  private getLogFilePath(): string {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `jobhermes-${date}.log`);
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.logLevel];
  }


  private writeToFile(entry: LogEntry): void {
    try {
      // Rotate log file daily
      const todayPath = this.getLogFilePath();
      if (todayPath !== this.currentLogFile) {
        this.currentLogFile = todayPath;
      }

      const line = `[${entry.timestamp}] [${entry.level.toUpperCase().padEnd(5)}] ${entry.message}${
        entry.context ? ` ${JSON.stringify(entry.context)}` : ''
      }\n`;

      fs.appendFileSync(this.currentLogFile, line, 'utf8');
    } catch {
      // Silently fail file logging to avoid recursive errors
    }
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const color = LEVEL_COLORS[level];
    const prefix = `${BOLD}${color}[${level.toUpperCase().padEnd(5)}]${RESET}`;
    const timeStr = `\x1b[90m[${timestamp}]${RESET}`;

    const contextStr = context ? ` \x1b[90m${JSON.stringify(context)}${RESET}` : '';
    console.log(`${timeStr} ${prefix} ${message}${contextStr}`);

    const entry: LogEntry = { level, message, timestamp, context };
    this.writeToFile(entry);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  section(title: string): void {
    const line = '─'.repeat(60);
    console.log(`\n\x1b[35m${line}`);
    console.log(`  🚀 ${title}`);
    console.log(`${line}${RESET}\n`);
  }

  success(message: string): void {
    console.log(`\x1b[32m✅ ${message}${RESET}`);
    const entry: LogEntry = { level: 'info', message: `✅ ${message}`, timestamp: new Date().toISOString() };
    this.writeToFile(entry);
  }
}

export const logger = new Logger();
