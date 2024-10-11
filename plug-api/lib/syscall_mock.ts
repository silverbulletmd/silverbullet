import { parse as parseYaml } from "@std/yaml";

// @ts-ignore: syscall is a global function
globalThis.syscall = (name: string, ...args: readonly any[]) => {
  switch (name) {
    case "yaml.parse":
      return Promise.resolve(parseYaml(args[0]));
    case "system.applyAttributeExtractors":
      return Promise.resolve({});
    default:
      throw Error(`Not implemented in tests: ${name}`);
  }
};
