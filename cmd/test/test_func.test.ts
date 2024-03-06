import * as YAML from "js-yaml";
import {
  EndpointRequest,
  EndpointResponse,
} from "../../server/hooks/endpoint.ts";

export async function hello() {
  const numbers = await syscall("addNumbers", 1, 2);
  return {
    yamlMessage: YAML.dump({ hello: "world" }),
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
