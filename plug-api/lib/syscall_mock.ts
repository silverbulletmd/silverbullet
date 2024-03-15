import { YAML } from "../../lib/deps_server.ts";

globalThis.syscall = (name: string, ...args: readonly any[]) => {
  switch (name) {
    case "yaml.parse":
      return Promise.resolve(YAML.parse(args[0]));
    case "system.applyAttributeExtractors":
      return Promise.resolve({});
    default:
      throw Error(`Not implemented in tests: ${name}`);
  }
};
