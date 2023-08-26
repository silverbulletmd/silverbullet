import type { SysCallMapping } from "../../plugos/system.ts";
import type { Client } from "../client.ts";
import { proxySyscalls } from "./util.ts";

export function storeProxySyscalls(client: Client): SysCallMapping {
  return proxySyscalls(client, [
    "store.delete",
    "store.deletePrefix",
    "store.deleteAll",
    "store.set",
    "store.batchSet",
    "store.batchDelete",
    "store.batchGet",
    "store.get",
    "store.has",
    "store.queryPrefix",
  ]);
}
