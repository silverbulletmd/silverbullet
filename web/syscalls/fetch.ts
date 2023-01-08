import type { SysCallMapping } from "../../plugos/system.ts";
import { proxySyscalls } from "../../plugos/syscalls/transport.ts";
import type { Space } from "../../common/spaces/space.ts";

export function sandboxFetchSyscalls(space: Space): SysCallMapping {
  return proxySyscalls(
    [
      "sandboxFetch.fetch",
    ],
    (ctx, name, ...args) => space.proxySyscall(ctx.plug, name, args),
  );
}
