import type { SysCallMapping } from "../../plugos/system.ts";
import type { Client } from "../client.ts";
import { proxySyscalls } from "./util.ts";

export function dataStoreProxySyscalls(client: Client): SysCallMapping {
  return proxySyscalls(client, [
    "datastore.delete",
    "datastore.set",
    "datastore.batchSet",
    "datastore.batchDelete",
    "datastore.batchGet",
    "datastore.get",
    "datastore.query",
  ]);
}
