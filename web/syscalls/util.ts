import { HttpSpacePrimitives } from "$common/spaces/http_space_primitives.ts";
import { SyscallContext, SysCallMapping } from "../../lib/plugos/system.ts";
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
    `${httpSpacePrimitives.url}/.rpc/${ctx.plug || "_"}/${name}`,
    {
      method: "POST",
      body: JSON.stringify(args),
    },
  );
  const result = await resp.json();
  if (result.error) {
    console.error("Remote syscall error", result.error);
    throw new Error(result.error);
  } else {
    return result.result;
  }
}
