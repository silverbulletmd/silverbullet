import { HttpSpacePrimitives } from "../../common/spaces/http_space_primitives.ts";
import { SyscallContext, SysCallMapping } from "../../plugos/system.ts";
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
  if (!ctx.plug) {
    throw new Error(`Cannot proxy ${name} syscall without plug context`);
  }
  const resp = await httpSpacePrimitives.authenticatedFetch(
    `${httpSpacePrimitives.url}/.rpc/${ctx.plug}/${name}`,
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
