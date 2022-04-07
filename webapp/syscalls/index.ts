import { SysCallMapping } from "../../plugos/system";
import { proxySyscalls } from "../../plugos/syscalls/transport";
import { WatchableSpace } from "../spaces/cache_space";

export function indexerSyscalls(space: WatchableSpace): SysCallMapping {
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
