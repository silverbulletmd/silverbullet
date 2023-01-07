import { proxySyscalls } from "../../plugos/syscalls/transport.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import { storeSyscalls } from "../../plugos/syscalls/store.sqlite.ts";
import { ISQLite } from "../../plugos/sqlite/sqlite_interface.ts";

export function clientStoreSyscalls(db: ISQLite): SysCallMapping {
  const storeCalls = storeSyscalls(db, "localData");
  return proxySyscalls(
    ["clientStore.get", "clientStore.set", "clientStore.delete"],
    (ctx, name, ...args) => {
      return storeCalls[name.replace("clientStore.", "store.")](ctx, ...args);
    },
  );
}
