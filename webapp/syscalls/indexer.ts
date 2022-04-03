import {Space} from "../space";
import {SysCallMapping} from "../../plugos/system";
import {transportSyscalls} from "../../plugos/syscalls/transport";

export function indexerSyscalls(space: Space): SysCallMapping {
  return transportSyscalls(
    [
      "scanPrefixForPage",
      "scanPrefixGlobal",
      "get",
      "set",
      "batchSet",
      "delete",
    ],
    (ctx, name, ...args) => space.remoteSyscall(ctx.plug, `index.${name}`, args)
  );
}
