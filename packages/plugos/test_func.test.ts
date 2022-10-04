import * as YAML from "https://deno.land/std/encoding/yaml.ts";

export function hello() {
  console.log(YAML.stringify({ hello: "world" }));

  return "hello";
}
