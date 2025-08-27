import type { ShellRequest, ShellResponse } from "../type/rpc.ts";
import type { ServerOptions } from "./http_server.ts";

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
      if (serverOptions.shellCommandWhiteList) {
        console.info(
          "Running with the following shell commands enabled:",
          serverOptions.shellCommandWhiteList,
        );
      } else {
        console.info("Running with ALL shell commands enabled.");
      }
      return new LocalShell(
        serverOptions.pagesPath,
        serverOptions.shellCommandWhiteList,
      );
    default:
      console.info(
        "Running in shell-less mode, meaning shell commands are disabled",
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

export class LocalShell implements ShellBackend {
  constructor(private cwd: string, private cmdWhiteList?: string[]) {
  }

  async handle(shellRequest: ShellRequest): Promise<ShellResponse> {
    if (this.cmdWhiteList && !this.cmdWhiteList.includes(shellRequest.cmd)) {
      console.error(
        "Not running shell command because not in whitelist",
        shellRequest,
      );
      return {
        code: -1,
        stdout: "",
        stderr: "Not allowed, command not in whitelist",
      };
    }
    console.log(
      "Running shell command:",
      shellRequest.cmd,
      shellRequest.args,
    );
    const p = new Deno.Command(shellRequest.cmd, {
      cwd: this.cwd,
      args: shellRequest.args,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    if (shellRequest.stdin) {
      // Write a string to stdin
      const encoder = new TextEncoder();
      const writer = p.stdin.getWriter();
      await writer.write(encoder.encode(shellRequest.stdin));
      writer.releaseLock();
    }
    await p.stdin.close();

    // Capture stdout and stderr
    const [stdout, stderr] = await Promise.all([
      readAll(p.stdout.getReader()),
      readAll(p.stderr.getReader()),
    ]);

    // Get the exit status
    const status = await p.status;

    return {
      stderr,
      stdout,
      code: status.code,
    };
  }
}

async function readAll(r: ReadableStreamDefaultReader) {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await r.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks.join();
}
