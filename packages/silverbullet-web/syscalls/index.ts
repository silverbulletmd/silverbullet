import { SysCallMapping } from "@silverbulletmd/plugos/system";
import { proxySyscalls } from "@silverbulletmd/plugos/syscalls/transport";
import { Space } from "@silverbulletmd/common/spaces/space";

export function indexerSyscalls(space: Space): SysCallMapping {
  return proxySyscalls(
    [
      "index.scanPrefixForPage",
      "index.scanPrefixGlobal",
      "index.get",
      "index.set",
      "index.batchSet",
      "index.delete",
    ],
    (ctx, name, ...args) => space.proxySyscall(ctx.plug, name, args)
  );
}
