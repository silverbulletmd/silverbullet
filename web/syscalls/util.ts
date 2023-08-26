import { SysCallMapping } from "../../plugos/system.ts";
import { SyscallResponse } from "../../server/rpc.ts";
import { Client } from "../client.ts";

export function proxySyscalls(client: Client, names: string[]): SysCallMapping {
  const syscalls: SysCallMapping = {};
  for (const name of names) {
    syscalls[name] = async (_ctx, ...args: any[]) => {
      if (!client.remoteSpacePrimitives) {
        throw new Error("Not supported");
      }
      const resp = await client.remoteSpacePrimitives.authenticatedFetch(
        `${client.remoteSpacePrimitives.url}/.rpc`,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "syscall",
            name,
            args,
          }),
        },
      );
      const result: SyscallResponse = await resp.json();
      if (result.error) {
        console.error("Remote syscall error", result.error);
        throw new Error(result.error);
      } else {
        return result.result;
      }
    };
  }
  return syscalls;
}
