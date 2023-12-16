import { HttpSpacePrimitives } from "../../common/spaces/http_space_primitives.ts";
import { SyscallContext, SysCallMapping } from "../../plugos/system.ts";
import { SyscallResponse } from "../../server/rpc.ts";
import { Client } from "../client.ts";

export function proxySyscalls(client: Client, names: string[]): SysCallMapping {
  const syscalls: SysCallMapping = {};
  for (const name of names) {
    syscalls[name] = (ctx, ...args: any[]) => {
      return proxySyscall(ctx, client.httpSpacePrimitives, name, args);
    };
  }
  return syscalls;
}

export async function proxySyscall(
  ctx: SyscallContext,
  httpSpacePrimitives: HttpSpacePrimitives,
  name: string,
  args: any[],
): Promise<any> {
  const resp = await httpSpacePrimitives.authenticatedFetch(
    `${httpSpacePrimitives.url}/.rpc`,
    {
      method: "POST",
      body: JSON.stringify({
        ctx: ctx.plug.name,
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
