/**
 * Enterprise logging utility for frontend application
 * Supports console logging (default) and optional file logging
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

class Logger {
  private logBuffer: LogEntry[] = [];
  private maxBufferSize = 1000;
  private enableFileLogging = false;
  private logLevel: LogLevel = 'info';

  /**
   * Configure logger settings
   */
  configure(options: {
    enableFileLogging?: boolean;
    logLevel?: LogLevel;
    maxBufferSize?: number;
  }) {
    if (options.enableFileLogging !== undefined) {
      this.enableFileLogging = options.enableFileLogging;
    }
    if (options.logLevel) {
      this.logLevel = options.logLevel;
    }
    if (options.maxBufferSize) {
      this.maxBufferSize = options.maxBufferSize;
    }
  }

  /**
   * Get numeric level for comparison
   */
  private getLevelValue(level: LogLevel): number {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    return levels[level];
  }

  /**
   * Check if log level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return this.getLevelValue(level) >= this.getLevelValue(this.logLevel);
  }

  /**
   * Create log entry
   */
  private createLogEntry(level: LogLevel, message: string, data?: any): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };
  }

  /**
   * Add log entry to buffer
   */
  private addToBuffer(entry: LogEntry) {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift(); // Remove oldest entry
    }
  }

  /**
   * Write logs to file (download as JSON)
   */
  exportLogsToFile() {
    if (this.logBuffer.length === 0) {
      console.warn('No logs to export');
      return;
    }

    const logData = JSON.stringify(this.logBuffer, null, 2);
    const blob = new Blob([logData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `app-logs-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Clear log buffer
   */
  clearLogs() {
    this.logBuffer = [];
  }

  /**
   * Get all logs
   */
  getLogs(): LogEntry[] {
    return [...this.logBuffer];
  }

  /**
   * Write verbose diagnostic log entry.
   */
  debug(message: string, data?: any) {
    if (!this.shouldLog('debug')) return;
    const entry = this.createLogEntry('debug', message, data);
    console.debug(`[DEBUG] ${message}`, data || '');
    this.addToBuffer(entry);
  }

  /**
   * Info log
   */
  info(message: string, data?: any) {
    if (!this.shouldLog('info')) return;
    const entry = this.createLogEntry('info', message, data);
    console.info(`[INFO] ${message}`, data || '');
    this.addToBuffer(entry);
  }

  /**
   * Warning log
   */
  warn(message: string, data?: any) {
    if (!this.shouldLog('warn')) return;
    const entry = this.createLogEntry('warn', message, data);
    console.warn(`[WARN] ${message}`, data || '');
    this.addToBuffer(entry);
  }

  /**
   * Error log
   */
  error(message: string, error?: any) {
    if (!this.shouldLog('error')) return;
    const entry = this.createLogEntry('error', message, error);
    console.error(`[ERROR] ${message}`, error || '');
    this.addToBuffer(entry);
  }
}

// Export singleton instance
export const logger = new Logger();

// Auto-export logs on page unload if file logging is enabled
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (logger['enableFileLogging'] && logger.getLogs().length > 0) {
      // Note: beforeunload has limitations, so we'll rely on manual export
      // or periodic exports for production
    }
  });
}
