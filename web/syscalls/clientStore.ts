import { dataStoreSyscalls } from "../../plugos/syscalls/dataStore.ts";
import { proxySyscalls } from "../../plugos/syscalls/transport.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import { DataStore } from "../../plugos/lib/dataStore.ts";

export function clientStoreSyscalls(
  ds: DataStore,
): SysCallMapping {
  const localStoreCalls = dataStoreSyscalls(ds);
  return proxySyscalls(
    ["clientStore.get", "clientStore.set", "clientStore.delete"],
    (ctx, name, ...args) => {
      return localStoreCalls[name.replace("clientStore.", "dataStore.")](
        ctx,
        ...args,
      );
    },
  );
}
