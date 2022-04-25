import { proxySyscalls } from "@plugos/plugos/syscalls/transport";
import { SysCallMapping } from "@plugos/plugos/system";
import { storeSyscalls } from "@plugos/plugos/syscalls/store.dexie_browser";

export function clientStoreSyscalls(): SysCallMapping {
  const storeCalls = storeSyscalls("local", "localData");
  return proxySyscalls(
    ["clientStore.get", "clientStore.set", "clientStore.delete"],
    (ctx, name, ...args) => {
      return storeCalls[name.replace("clientStore.", "store.")](ctx, ...args);
    }
  );
}
