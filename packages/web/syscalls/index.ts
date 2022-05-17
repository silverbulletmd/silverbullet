import { SysCallMapping } from "@plugos/plugos/system";
import { proxySyscalls } from "@plugos/plugos/syscalls/transport";
import { Space } from "@silverbulletmd/common/spaces/space";

export function indexerSyscalls(space: Space): SysCallMapping {
  return proxySyscalls(
    [
      "index.queryPrefix",
      "index.get",
      "index.set",
      "index.batchSet",
      "index.delete",
    ],
    (ctx, name, ...args) => space.proxySyscall(ctx.plug, name, args)
  );
}
