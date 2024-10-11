import type { SysCallMapping } from "$lib/plugos/system.ts";
import { parse } from "../space_lua/parse.ts";

export function luaSyscalls(): SysCallMapping {
  return {
    "lua.parse": (_ctx, code: string) => {
      return parse(code);
    },
  };
}
