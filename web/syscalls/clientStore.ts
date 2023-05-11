import { proxySyscalls } from "../../plugos/syscalls/transport.ts";
import { SysCallMapping } from "../../plugos/system.ts";

// DEPRECATED, use store directly
export function clientStoreSyscalls(
  storeCalls: SysCallMapping,
): SysCallMapping {
  return proxySyscalls(
    ["clientStore.get", "clientStore.set", "clientStore.delete"],
    (ctx, name, ...args) => {
      return storeCalls[name.replace("clientStore.", "store.")](ctx, ...args);
    },
  );
}
