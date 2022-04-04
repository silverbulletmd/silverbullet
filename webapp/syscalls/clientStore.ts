import {transportSyscalls} from "../../plugos/syscalls/transport";
import {SysCallMapping} from "../../plugos/system";
import {storeSyscalls} from "../../plugos/syscalls/store.dexie_browser";

export function clientStoreSyscalls(): SysCallMapping {
  const storeCalls = storeSyscalls("local", "localData");
  return transportSyscalls(
    ["clientStore.get", "clientStore.set", "clientStore.delete"],
    (ctx, name, ...args) => {
      return storeCalls[name.replace("clientStore.", "store.")](ctx, ...args);
    }
  );
}
