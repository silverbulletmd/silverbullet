import * as YAML from "js-yaml";

export async function hello() {
  // @ts-ignore: syscall is a global function
  const numbers = await syscall("addNumbers", 1, 2);
  return {
    yamlMessage: YAML.dump({ hello: "world" }),
    addedNumbers: numbers,
  };
}
