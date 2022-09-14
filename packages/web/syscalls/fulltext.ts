import { SysCallMapping } from "@plugos/plugos/system";
import { proxySyscalls } from "@plugos/plugos/syscalls/transport";
import { Space } from "@silverbulletmd/common/spaces/space";

export function fulltextSyscalls(space: Space): SysCallMapping {
  return proxySyscalls(
    ["fulltext.search", "fulltext.delete", "fulltext.index"],
    (ctx, name, ...args) => space.proxySyscall(ctx.plug, name, args)
  );
}
