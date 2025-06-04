import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type { Client } from "../client.ts";
import { ShellStreamClient } from "../shell_stream_client.ts";

/**
 * Interface for the shell stream client
 */
export interface ShellStream {
  /**
   * Send data to the process stdin
   */
  send(data: string): void;

  /**
   * Send a signal to the process
   */
  kill(signal: string): void;

  /**
   * Close the connection
   */
  close(): void;
}

export function shellSyscalls(
  client: Client,
): SysCallMapping {
  return {
    "shell.run": async (
      _ctx,
      cmd: string,
      args: string[],
    ): Promise<{ stdout: string; stderr: string; code: number }> => {
      if (!client.httpSpacePrimitives) {
        throw new Error("Not supported in fully local mode");
      }
      const resp = client.httpSpacePrimitives.authenticatedFetch(
        `${client.httpSpacePrimitives.url}/.shell`,
        {
          method: "POST",
          body: JSON.stringify({
            cmd,
            args,
          }),
        },
      );
      const { code, stderr, stdout } = await (await resp).json();
      return { code, stderr, stdout };
    },
    "shell.spawn": (
      _ctx,
      cmd: string,
      args: string[],
    ): ShellStreamClient => {
      if (!client.httpSpacePrimitives) {
        throw new Error("Not supported in fully local mode");
      }

      // Create a shell stream client
      return new ShellStreamClient({
        httpSpacePrimitives: client.httpSpacePrimitives,
        cmd,
        args: args || [],
      });
    },
  };
}
