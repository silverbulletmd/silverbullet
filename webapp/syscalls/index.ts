import { SysCallMapping } from "../../plugos/system";
import { proxySyscalls } from "../../plugos/syscalls/transport";
import { Space } from "../spaces/space";

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
