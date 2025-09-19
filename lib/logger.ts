// Logger that monkey patches console methods with prefixes and can capture logs for server transmission

export interface LogEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  timestamp: number;
  message: string;
}

export class Logger {
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };
  public logBuffer: LogEntry[] = [];

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
      message: args.map((arg) => {
        if (typeof arg === "string") {
          return arg;
        }
        try {
          return JSON.stringify(arg);
        } catch {
          // Handle circular references or other JSON.stringify failures
          return String(arg);
        }
      }).join(" "),
    };

    this.logBuffer.push(entry);

    // Maintain max capture size by removing oldest entries
    if (this.logBuffer.length > this.maxCaptureSize) {
      this.logBuffer.shift();
    }
  }

  /**
   * Posts all buffered logs to a server endpoint
   */
  async postToServer(logEndpoint: string, source: string) {
    const logs = this.logBuffer;
    if (logs.length > 0) {
      // Flush the buffer
      const logCopy = [...this.logBuffer];
      this.logBuffer = [];
      try {
        const resp = await fetch(logEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(logCopy.map((entry) => ({ ...entry, source }))),
        });
        if (!resp.ok) {
          throw new Error("Failed to post logs to server");
        }
      } catch (e: any) {
        console.warn("Could not post logs to server", e.message);
        // Put back the logs into the buffer
        this.logBuffer.unshift(...logCopy);
      }
    }
  }
}

// Global logger instance
let globalLogger: Logger | undefined = undefined;

export function initLogger(prefix: string = ""): Logger {
  globalLogger = new Logger(prefix);
  return globalLogger;
}
