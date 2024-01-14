import { HttpSpacePrimitives } from "../../common/spaces/http_space_primitives.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import { Client } from "../client.ts";

export function proxySyscalls(client: Client, names: string[]): SysCallMapping {
  const syscalls: SysCallMapping = {};
  for (const name of names) {
    syscalls[name] = (...args: any[]) => {
      return proxySyscall(client.httpSpacePrimitives, name, args);
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
    `${httpSpacePrimitives.url}/.rpc/${name}`,
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
