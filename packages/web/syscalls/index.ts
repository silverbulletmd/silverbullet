import { SysCallMapping } from "../../plugos/system.ts";
import { proxySyscalls } from "../../plugos/syscalls/transport.ts";
import { Space } from "../../common/spaces/space.ts";

export function indexerSyscalls(space: Space): SysCallMapping {
  return proxySyscalls(
    [
      "index.queryPrefix",
      "index.get",
      "index.set",
      "index.batchSet",
      "index.delete",
    ],
    (ctx, name, ...args) => space.proxySyscall(ctx.plug, name, args),
  );
}
