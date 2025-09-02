// Logger that monkey patches console methods with prefixes and can capture logs for server transmission

export interface LogEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  timestamp: number;
  message: string;
  args: any[];
}

export class Logger {
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };
  private logCapture: LogEntry[] = [];

  constructor(
    private prefix: string = "",
    private maxCaptureSize: number = 1000,
  ) {
    this.prefix = prefix;

    // Store original console methods
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };

    this.patchConsole();
  }

  private patchConsole(): void {
    const createPatchedMethod = (level: keyof typeof this.originalConsole) => {
      return (...args: any[]) => {
        const prefixedArgs = this.prefix ? [this.prefix, ...args] : args;

        // Call original console method
        this.originalConsole[level](...prefixedArgs);

        // Capture log if capturing is enabled
        this.captureLog(level, args);
      };
    };

    console.log = createPatchedMethod("log");
    console.info = createPatchedMethod("info");
    console.warn = createPatchedMethod("warn");
    console.error = createPatchedMethod("error");
    console.debug = createPatchedMethod("debug");
  }

  private captureLog(level: LogEntry["level"], args: any[]): void {
    const entry: LogEntry = {
      level,
      timestamp: Date.now(),
      message: args.map((arg) =>
        typeof arg === "string" ? arg : JSON.stringify(arg)
      ).join(" "),
      args: args.map((arg) => {
        // Serialize complex objects for safe transmission
        try {
          return typeof arg === "object"
            ? JSON.parse(JSON.stringify(arg))
            : arg;
        } catch {
          return String(arg);
        }
      }),
    };

    this.logCapture.push(entry);

    // Maintain max capture size by removing oldest entries
    if (this.logCapture.length > this.maxCaptureSize) {
      this.logCapture.shift();
    }
  }

  /**
   * Get captured log entries
   */
  getCapturedLogs(): LogEntry[] {
    return [...this.logCapture];
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

/**
 * Initialize global logger with prefix
 */
export function initLogger(prefix: string = ""): Logger {
  globalLogger = new Logger(prefix);
  return globalLogger;
}

/**
 * Get the global logger instance
 */
export function getLogger(): Logger | null {
  return globalLogger;
}
