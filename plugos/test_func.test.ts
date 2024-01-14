import * as YAML from "https://deno.land/std@0.184.0/yaml/mod.ts";
import { EndpointRequest, EndpointResponse } from "./hooks/endpoint.ts";

export async function hello() {
  const numbers = await syscall("addNumbers", 1, 2);
  return {
    yamlMessage: YAML.stringify({ hello: "world" }),
    addedNumbers: numbers,
  };
}

export function endpoint(req: EndpointRequest): EndpointResponse {
  console.log("Req", req);
  return {
    status: 200,
    body: [1, 2, 3],
    headers: { "Content-type": "application/json" },
  };
}
