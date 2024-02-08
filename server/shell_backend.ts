import type { SpaceServerConfig } from "./instance.ts";
import { ShellRequest, ShellResponse } from "../type/rpc.ts";

/**
 * Configuration via environment variables:
 * - SB_SHELL_BACKEND: "local" or "off"
 */

export function determineShellBackend(
  spaceServerConfig: SpaceServerConfig,
): ShellBackend {
  const backendConfig = Deno.env.get("SB_SHELL_BACKEND") || "local";
  switch (backendConfig) {
    case "local":
      return new LocalShell(spaceServerConfig.pagesPath);
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
