import * as YAML from "https://deno.land/std@0.184.0/yaml/mod.ts";

export function hello() {
  console.log(YAML.stringify({ hello: "world" }));

  return "hello";
}
