// Logger that monkey patches console methods with prefixes and can capture logs for server transmission

export type LogEntry = {
  level: "log" | "info" | "warn" | "error" | "debug";
  timestamp: number;
  message: string;
};

export class Logger {
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };
  public logBuffer: LogEntry[] = [];
  private forward?: (entry: LogEntry) => void;
  // Forwarding can itself log (a failed postMessage); that must not forward again
  private forwarding = false;

  constructor(
    private prefix: string = "",
    private maxCaptureSize: number = 1000,
  ) {
    this.prefix = prefix;

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

        this.originalConsole[level](...prefixedArgs);

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
      message: args
        .map((arg) => {
          if (typeof arg === "string") {
            return arg;
          }
          try {
            return JSON.stringify(arg);
          } catch {
            // Handle circular references or other JSON.stringify failures
            return String(arg);
          }
        })
        .join(" "),
    };

    this.logBuffer.push(entry);
    if (this.forward && !this.forwarding) {
      this.forwarding = true;
      try {
        this.forward(entry);
      } catch {
        // Forwarding is best effort; the entry is still buffered
      } finally {
        this.forwarding = false;
      }
    }

    if (this.logBuffer.length > this.maxCaptureSize) {
      this.logBuffer.shift();
    }
  }

  /** Also hands every captured entry to `fn`, e.g. to show it in the main window. */
  forwardTo(fn: (entry: LogEntry) => void): void {
    this.forward = fn;
  }

  /**
   * Posts all buffered logs to a server endpoint
   */
  async postToServer(logEndpoint: string, source: string) {
    const logs = this.logBuffer;
    if (logs.length > 0) {
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
        this.logBuffer.unshift(...logCopy);
      }
    }
  }
}

let globalLogger: Logger | undefined;

export function initLogger(prefix: string = ""): Logger {
  globalLogger = new Logger(prefix);
  return globalLogger;
}
