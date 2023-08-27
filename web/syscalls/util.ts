import { HttpSpacePrimitives } from "../../common/spaces/http_space_primitives.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import { SyscallResponse } from "../../server/rpc.ts";
import { Client } from "../client.ts";

export function proxySyscalls(client: Client, names: string[]): SysCallMapping {
  const syscalls: SysCallMapping = {};
  for (const name of names) {
    syscalls[name] = (_ctx, ...args: any[]) => {
      return proxySyscall(client.remoteSpacePrimitives, name, args);
    };
  }
  return syscalls;
}

export async function proxySyscall(
  httpSpacePrimitives: HttpSpacePrimitives,
  name: string,
  args: any[],
): Promise<any> {
  const resp = await httpSpacePrimitives.authenticatedFetch(
    `${httpSpacePrimitives.url}/.rpc`,
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
}
