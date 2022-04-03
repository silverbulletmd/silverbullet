import {Space} from "../space";
import {SysCallMapping} from "../../plugos/system";
import {transportSyscalls} from "../../plugos/syscalls/transport";

export function indexerSyscalls(space: Space): SysCallMapping {
  return transportSyscalls(
    [
      "index.scanPrefixForPage",
      "index.scanPrefixGlobal",
      "index.get",
      "index.set",
      "index.batchSet",
      "index.delete",
    ],
    (ctx, name, ...args) => space.remoteSyscall(ctx.plug, name, args)
  );
}
