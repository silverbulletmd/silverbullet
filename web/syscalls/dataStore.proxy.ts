import type { SysCallMapping } from "../../plugos/system.ts";
import type { Client } from "../client.ts";
import { proxySyscalls } from "./util.ts";

export function dataStoreProxySyscalls(client: Client): SysCallMapping {
  return proxySyscalls(client, [
    "dataStore.delete",
    "dataStore.set",
    "dataStore.batchSet",
    "dataStore.batchDelete",
    "dataStore.batchGet",
    "dataStore.get",
    "dataStore.query",
  ]);
}
