import { SysCallMapping } from "../../plugos/system.ts";
import { YAML } from "../../web/deps.ts";

export function yamlSyscalls(): SysCallMapping {
  return {
    "yaml.parse": (_ctx, text: string): any => {
      return YAML.parse(text);
    },
    "yaml.stringify": (_ctx, obj: any): string => {
      return YAML.stringify(obj, {
        noArrayIndent: true,
        noCompatMode: true,
      });
    },
  };
}
