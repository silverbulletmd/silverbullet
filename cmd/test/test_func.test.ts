import * as YAML from "js-yaml";

export async function hello() {
    const numbers = await syscall("addNumbers", 1, 2);
    return {
        yamlMessage: YAML.dump({ hello: "world" }),
        addedNumbers: numbers,
    };
}
