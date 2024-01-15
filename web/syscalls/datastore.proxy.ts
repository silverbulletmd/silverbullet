import { KvQuery } from "$sb/types.ts";
import { LimitedMap } from "../../plug-api/lib/limited_map.ts";
import type { SysCallMapping } from "../../plugos/system.ts";
import type { Client } from "../client.ts";
import { proxySyscall, proxySyscalls } from "./util.ts";

export function dataStoreProxySyscalls(client: Client): SysCallMapping {
  return proxySyscalls(client, [
    "datastore.delete",
    "datastore.set",
    "datastore.batchSet",
    "datastore.batchDelete",
    "datastore.batchGet",
    "datastore.query",
    "datastore.get",
  ]);
}
