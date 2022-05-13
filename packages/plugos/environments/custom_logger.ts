export type LogLevel = "info" | "warn" | "error" | "log";

export class ConsoleLogger {
  print: boolean;
  callback: (level: LogLevel, entry: string) => void;

  constructor(
    callback: (level: LogLevel, entry: string) => void,
    print: boolean = true
  ) {
    this.print = print;
    this.callback = callback;
  }

  log(...args: any[]): void {
    this.push("log", args);
  }

  warn(...args: any[]): void {
    this.push("warn", args);
  }

  error(...args: any[]): void {
    this.push("error", args);
  }

  info(...args: any[]): void {
    this.push("info", args);
  }

  push(level: LogLevel, args: any[]) {
    this.callback(level, this.logMessage(args));
    if (this.print) {
      console[level](...args);
    }
  }

  logMessage(values: any[]): string {
    let pieces: string[] = [];
    for (let val of values) {
      switch (typeof val) {
        case "string":
        case "number":
          pieces.push("" + val);
          break;
        case "undefined":
          pieces.push("undefined");
          break;
        default:
          try {
            let s = JSON.stringify(val, null, 2);
            if (s.length > 500) {
              s = s.substring(0, 500) + "...";
            }
            pieces.push(s);
          } catch {
            // May be cyclical reference
            pieces.push("[circular object]");
          }
      }
    }
    return pieces.join(" ");
  }
}
