import { Space } from "../space";
import { SysCallMapping } from "../../plugbox/system";
import { transportSyscalls } from "../../plugbox/syscall/transport";

export default function indexerSyscalls(space: Space): SysCallMapping {
  return transportSyscalls(
    [
      "scanPrefixForPage",
      "scanPrefixGlobal",
      "get",
      "set",
      "batchSet",
      "delete",
    ],
    (name, ...args) => space.wsCall(`index.${name}`, ...args)
  );
}
