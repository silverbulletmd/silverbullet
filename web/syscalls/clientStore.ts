import { SysCallMapping } from "../../plugos/system.ts";
import { DataStore } from "../../plugos/lib/datastore.ts";
import { KvKey } from "$sb/types.ts";

export function clientStoreSyscalls(
  ds: DataStore,
  prefix: KvKey = ["client"],
): SysCallMapping {
  return {
    "clientStore.get": (ctx, key: string): Promise<any> => {
      return ds.get([...prefix, ctx.plug!.name!, key]);
    },
    "clientStore.set": (ctx, key: string, val: any): Promise<void> => {
      return ds.set([...prefix, ctx.plug!.name!, key], val);
    },
    "clientStore.delete": (ctx, key: string): Promise<void> => {
      return ds.delete([...prefix, ctx.plug!.name!, key]);
    },
  };
}
