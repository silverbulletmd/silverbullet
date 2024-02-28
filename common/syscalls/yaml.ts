import { SysCallMapping } from "../../lib/plugos/system.ts";
import YAML from "js-yaml";

type YamlStringifyOptions = {
  /** indentation width to use (in spaces). */
  indent?: number;
  /** when true, will not add an indentation level to array elements */
  noArrayIndent?: boolean;
  /** do not throw on invalid types (like function in the safe schema) and skip pairs and single values with such types. */
  skipInvalid?: boolean;
  /** specifies level of nesting, when to switch from block to flow style for collections. -1 means block style everwhere */
  flowLevel?: number;
  /** if true, sort keys when dumping YAML. If a function, use the function to sort the keys. (default: false) */
  sortKeys?: boolean;
  /** set max line width. (default: 80) */
  lineWidth?: number;
  /** if true, don't convert duplicate objects into references (default: false) */
  noRefs?: boolean;
  /** if true don't try to be compatible with older yaml versions. Currently: don't quote "yes", "no" and so on, as required for YAML 1.1 (default: false) */
  noCompatMode?: boolean;
  /**
   * if true flow sequences will be condensed, omitting the space between `key: value` or `a, b`. Eg. `'[a,b]'` or `{a:{b:c}}`.
   * Can be useful when using yaml for pretty URL query params as spaces are %-encoded. (default: false).
   */
  condenseFlow?: boolean;
  /** strings will be quoted using this quoting style. If you specify single quotes, double quotes will still be used for non-printable characters. (default: `'`) */
  quotingType?: "'" | '"';
  /** if true, all non-key strings will be quoted even if they normally don't need to. (default: false) */
  forceQuotes?: boolean;
};

export function yamlSyscalls(): SysCallMapping {
  return {
    "yaml.parse": (_ctx, text: string): any => {
      return YAML.load(text);
    },
    "yaml.stringify": (
      _ctx,
      obj: any,
      options: YamlStringifyOptions = {},
    ): string => {
      return YAML.dump(obj, {
        quotingType: '"',
        noCompatMode: true,
        ...options,
      });
    },
  };
}
