import { Sandbox } from "../sandbox.ts";
import { Plug } from "../plug.ts";

export function createSandbox(plug: Plug<any>): Sandbox {
  return new Sandbox(plug, {
    deno: {
      permissions: {
        // Disallow network access
        net: false,
        // This is required for console logging to work, apparently?
        env: true,
        // No talking to native code
        ffi: false,
        // No invocation of shell commands
        run: false,
        // No read access to the file system
        read: false,
        // No write access to the file system
        write: false,
      },
    },
    // Have to do this because the "deno" option is not standard and doesn't typecheck yet
  } as any);
}
