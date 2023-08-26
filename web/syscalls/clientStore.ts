import { KVStore } from "../../plugos/lib/kv_store.ts";
import { storeSyscalls } from "../../plugos/syscalls/store.ts";
import { proxySyscalls } from "../../plugos/syscalls/transport.ts";
import { SysCallMapping } from "../../plugos/system.ts";

export function clientStoreSyscalls(
  db: KVStore,
): SysCallMapping {
  const localStoreCalls = storeSyscalls(db);
  return proxySyscalls(
    ["clientStore.get", "clientStore.set", "clientStore.delete"],
    (ctx, name, ...args) => {
      return localStoreCalls[name.replace("clientStore.", "store.")](
        ctx,
        ...args,
      );
    },
  );
}
