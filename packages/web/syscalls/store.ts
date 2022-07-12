import { SysCallMapping } from "@plugos/plugos/system";
import { proxySyscalls } from "@plugos/plugos/syscalls/transport";
import { Space } from "@silverbulletmd/common/spaces/space";

export function storeSyscalls(space: Space): SysCallMapping {
  return proxySyscalls(
    [
      "store.queryPrefix",
      "store.get",
      "store.set",
      "store.batchSet",
      "store.delete",
      "store.deletePrefix",
    ],
    (ctx, name, ...args) => space.proxySyscall(ctx.plug, name, args)
  );
}
