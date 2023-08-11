import * as YAML from "https://deno.land/std@0.184.0/yaml/mod.ts";
import { EndpointRequest, EndpointResponse } from "./hooks/endpoint.ts";

export function hello() {
  console.log(YAML.stringify({ hello: "world" }));

  return "hello";
}

export function endpoint(req: EndpointRequest): EndpointResponse {
  console.log("Req", req);
  return {
    status: 200,
    body: [1, 2, 3],
    headers: { "Content-type": "application/json" },
  };
}
