import type { ShellRequest, ShellResponse } from "../type/rpc.ts";
import type { ServerOptions } from "./http_server.ts";
import { timeout } from "../lib/async.ts";

/**
 * Configuration via environment variables:
 * - SB_SHELL_BACKEND: "local" or "off"
 */

export function determineShellBackend(
  serverOptions: ServerOptions,
): ShellBackend {
  const backendConfig = Deno.env.get("SB_SHELL_BACKEND") || "local";
  switch (backendConfig) {
    case "local":
      return new LocalShell(serverOptions.pagesPath);
    default:
      console.info(
        "Running in shellless mode, meaning shell commands are disabled",
      );
      return new NotSupportedShell();
  }
}

export interface ShellBackend {
  handle(shellRequest: ShellRequest): Promise<ShellResponse>;
}

export class NotSupportedShell implements ShellBackend {
  handle(): Promise<ShellResponse> {
    return Promise.resolve({
      stdout: "",
      stderr: "Not supported",
      code: 1,
    });
  }
}

export class StreamingShell {
  private process: Deno.ChildProcess | null = null;
  private outputHandlers: Array<
    (type: string, data: string) => void
  > = [];
  private textDecoder = new TextDecoder();
  private textEncoder = new TextEncoder();

  constructor(private cwd: string) {
  }

  start(cmd: string, args: string[]): void {
    console.log("Starting streaming shell:", cmd, args);

    this.process = new Deno.Command(cmd, {
      cwd: this.cwd,
      args: args,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    // Handle stdout
    this.readStream(this.process.stdout, "stdout");

    // Handle stderr
    this.readStream(this.process.stderr, "stderr");

    // Handle process exit
    this.process.status.then((status) => {
      this.notifyOutput(
        "exit",
        "json",
        JSON.stringify({ code: status.code || 0 }),
      );

      // Process is already exited, just set to null
      this.process = null;
    });
  }

  async writeToStdin(data: string): Promise<void> {
    if (!this.process || !this.process.stdin) {
      throw new Error("Process not started or stdin not available");
    }

    const writer = this.process.stdin.getWriter();
    try {
      // Add newline for text data
      await writer.write(this.textEncoder.encode(data + "\n"));
    } finally {
      writer.releaseLock();
    }
  }

  onOutput(
    handler: (type: string, data: string) => void,
  ): void {
    this.outputHandlers.push(handler);
  }

  /**
   * Send a signal to the process
   * @param signal The signal to send (e.g., "SIGTERM", "SIGINT", "SIGKILL")
   * @returns True if the signal was sent successfully, false otherwise
   */
  sendSignal(signal: string): boolean {
    if (!this.process) {
      console.error("Cannot send signal: Process not started");
      return false;
    }

    try {
      // Convert signal string to Deno.Signal enum
      let denoSignal: Deno.Signal;
      switch (signal.toUpperCase()) {
        case "SIGINT":
          denoSignal = "SIGINT";
          break;
        case "SIGTERM":
          denoSignal = "SIGTERM";
          break;
        case "SIGKILL":
          denoSignal = "SIGKILL";
          break;
        case "SIGHUP":
          denoSignal = "SIGHUP";
          break;
        default:
          console.error(`Unsupported signal: ${signal}`);
          return false;
      }

      this.process.kill(denoSignal);
      console.log(`Sent ${signal} to process`);
      return true;
    } catch (e) {
      console.error(`Error sending ${signal} to process:`, e);
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.process) {
      try {
        // First try to send SIGTERM to allow graceful shutdown
        try {
          console.log("Sending SIGTERM to process");
          this.process.kill("SIGTERM");
        } catch (e) {
          console.error("Error sending SIGTERM to process:", e);
        }

        // Close stdin if it's available
        if (this.process.stdin) {
          try {
            // Create a writer to check if the stream is writable
            const writer = this.process.stdin.getWriter();
            writer.releaseLock(); // Release immediately to avoid locking

            // If we got here, the stream is still open, so close it
            this.process.stdin.close();
          } catch (e) {
            // If we get an error, the stream might already be closed or errored
            // Just log it and continue
            console.log("Note: stdin already closed or errored:", e);
          }
        }

        // Wait for the process to exit with a short timeout
        try {
          const status = await Promise.race([
            this.process.status,
            timeout(500).then(() => {
              throw new Error("Process exit timeout after SIGTERM");
            }),
          ]);
          console.log("Process exited with code:", status.code);
          this.process = null;
          return;
        } catch (e) {
          console.log("Process did not exit after SIGTERM:", e);
        }

        // If we're here, the process didn't exit after SIGTERM
        // Try SIGKILL as a last resort
        if (this.process) { // Check if process is still not null
          try {
            console.log("Sending SIGKILL to process");
            this.process.kill("SIGKILL");

            // Wait again with a longer timeout
            const status = await Promise.race([
              this.process.status,
              timeout(500).then(() => {
                throw new Error("Process exit timeout after SIGKILL");
              }),
            ]);
            console.log("Process exited with code after SIGKILL:", status.code);
          } catch (e) {
            console.error(
              "Error waiting for process to exit after SIGKILL:",
              e,
            );
          }
        }
      } catch (e) {
        console.error("Error closing process:", e);
      }

      // Always set process to null to avoid memory leaks
      this.process = null;
    }
  }

  private async readStream(
    stream: ReadableStream<Uint8Array>,
    type: string,
  ): Promise<void> {
    const reader = stream.getReader();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        // Handle as text data (UTF-8)
        const text = this.textDecoder.decode(value, { stream: true });
        if (text.trim()) {
          console.log(`${type.toUpperCase()}: ${text}`);
          this.notifyOutput(type, "text", text);
        }
      }
    } catch (e) {
      const error = e as Error;
      console.error(`Error reading ${type}:`, error);
      this.notifyOutput("error", "text", `Stream error: ${error.message}`);
    } finally {
      reader.releaseLock();
    }
  }

  private notifyOutput(type: string, _format: string, data: string): void {
    for (const handler of this.outputHandlers) {
      handler(type, data);
    }
  }
}

export class LocalShell implements ShellBackend {
  constructor(private cwd: string) {
  }

  async handle(shellRequest: ShellRequest): Promise<ShellResponse> {
    console.log(
      "Running shell command:",
      shellRequest.cmd,
      shellRequest.args,
    );
    const p = new Deno.Command(shellRequest.cmd, {
      cwd: this.cwd,
      args: shellRequest.args,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await p.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    if (output.code !== 0) {
      console.error("Error running shell command", stdout, stderr);
    }

    return {
      stderr,
      stdout,
      code: output.code,
    };
  }
}
