import type { Context } from "hono";
import type { ShellRequest } from "@silverbulletmd/silverbullet/type/rpc";
import type { ShellBackend } from "./shell_backend.ts";
import { StreamingShell } from "./shell_backend.ts";
import { removeUrlPrefix } from "$lib/url_prefix.ts";

/**
 * Handles the /.shell endpoint for non-streaming shell commands
 */
export async function handleShellEndpoint(
  c: Context,
  shellBackend: ShellBackend,
  readOnly: boolean,
): Promise<Response> {
  const req = c.req;
  const body = await req.json();
  try {
    if (readOnly) {
      return c.text("Read only mode, no shell commands allowed", 405);
    }
    const shellCommand: ShellRequest = body;
    // Note: in read-only this is set to NoShellSupport, so don't worry
    const shellResponse = await shellBackend.handle(shellCommand);
    return c.json(shellResponse);
  } catch (e: any) {
    console.error("Shell error", e);
    return c.text(e.message, 500);
  }
}

/**
 * Handles the /.shell/stream endpoint for streaming shell commands
 */
export function handleShellStreamEndpoint(
  c: Context,
  cwd: string,
  readOnly: boolean,
  hostUrlPrefix?: string,
): Response {
  const req = c.req;
  const url = new URL(removeUrlPrefix(req.url, hostUrlPrefix));

  // Check if read-only mode is enabled
  if (readOnly) {
    return c.text("Read only mode, no shell commands allowed", 405);
  }

  // Get command and arguments from query parameters
  const cmd = url.searchParams.get("cmd");
  if (!cmd) {
    return c.text("Missing cmd parameter", 400);
  }

  let args: string[] = [];
  const argsParam = url.searchParams.get("args");
  if (argsParam) {
    try {
      args = JSON.parse(argsParam);
      if (!Array.isArray(args)) {
        return c.text("args must be a JSON array", 400);
      }
    } catch (_e) {
      return c.text("Invalid args parameter: must be a JSON array", 400);
    }
  }

  // Create a streaming shell
  const shell = new StreamingShell(cwd);

  // Upgrade the connection to a WebSocket
  try {
    const { socket, response } = Deno.upgradeWebSocket(req.raw);

    // Set up WebSocket event handlers
    socket.onopen = () => {
      // Start the shell process when the WebSocket is opened
      shell.start(cmd, args);

      // Forward shell output to the WebSocket
      shell.onOutput((type, data) => {
        socket.send(JSON.stringify({
          type,
          data,
        }));
      });
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "stdin") {
          await shell.writeToStdin(message.data);
        } else if (message.type === "signal") {
          const success = shell.sendSignal(message.signal);
          if (!success) {
            socket.send(JSON.stringify({
              type: "error",
              data: `Failed to send signal: ${message.signal}`,
            }));
          }
        }
      } catch (e) {
        console.error("Error handling WebSocket message:", e);
        socket.send(JSON.stringify({
          type: "error",
          data: `Error: ${e}`,
        }));
      }
    };

    socket.onclose = async () => {
      await shell.close();
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      shell.close().catch((e) => {
        console.error("Error closing shell:", e);
      });
    };

    return response;
  } catch (e) {
    console.error("WebSocket upgrade failed:", e);
    return c.text("WebSocket upgrade failed", 400);
  }
}
