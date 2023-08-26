import { SysCallMapping } from "../../plugos/system.ts";
import { Client } from "../client.ts";
import { proxySyscalls } from "./util.ts";

export function indexProxySyscalls(client: Client): SysCallMapping {
  return proxySyscalls(client, [
    "index.set",
    "index.batchSet",
    "index.delete",
    "index.get",
    "index.queryPrefix",
    "index.clearPageIndexForPage",
    "index.deletePrefixForPage",
    "index.clearPageIndex",
  ]);
}
