import { SysCallMapping } from "../../plugos/system.ts";
import { proxySyscalls } from "../../plugos/syscalls/transport.ts";
import { Space } from "../../common/spaces/space.ts";

export function storeSyscalls(space: Space): SysCallMapping {
  return proxySyscalls(
    [
      "store.queryPrefix",
      "store.get",
      "store.has",
      "store.set",
      "store.batchSet",
      "store.delete",
      "store.deletePrefix",
    ],
    (ctx, name, ...args) => space.proxySyscall(ctx.plug, name, args),
  );
}
