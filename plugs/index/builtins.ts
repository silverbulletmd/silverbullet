import { system } from "@silverbulletmd/silverbullet/syscalls";
import type { QueryProviderEvent } from "@silverbulletmd/silverbullet/types";
import { applyQuery } from "@silverbulletmd/silverbullet/lib/query";
import { builtinFunctions } from "$lib/builtin_query_functions.ts";

export async function syscallSourceProvider({
  query,
  variables,
}: QueryProviderEvent): Promise<any[]> {
  const syscalls = await system.listSyscalls();
  return applyQuery(
    { ...query, distinct: true },
    syscalls,
    variables || {},
    builtinFunctions,
  );
}

export async function commandSourceProvider({
  query,
  variables,
}: QueryProviderEvent): Promise<any[]> {
  const commands = await system.listCommands();
  return applyQuery(
    { ...query, distinct: true },
    Object.values(commands),
    variables || {},
    builtinFunctions,
  );
}
