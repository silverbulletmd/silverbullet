import { SysCallMapping } from "../../plugos/system.ts";
import { proxySyscalls } from "../../plugos/syscalls/transport.ts";
import { Space } from "../../common/spaces/space.ts";

export function fulltextSyscalls(space: Space): SysCallMapping {
  return proxySyscalls(
    ["fulltext.search", "fulltext.delete", "fulltext.index"],
    (ctx, name, ...args) => space.proxySyscall(ctx.plug, name, args),
  );
}
