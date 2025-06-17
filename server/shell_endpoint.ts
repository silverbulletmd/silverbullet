import type { Context } from "hono";
import type { ShellRequest } from "@silverbulletmd/silverbullet/type/rpc";
import type { ShellBackend } from "./shell_backend.ts";

/**
 * Handles the /.shell endpoint for running shell commands
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
