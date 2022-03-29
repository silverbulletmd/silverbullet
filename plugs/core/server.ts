import { EndpointRequest, EndpointResponse } from "../../plugos/hooks/endpoint";

export function endpointTest(req: EndpointRequest): EndpointResponse {
  console.log("I'm running on the server!", req);
  return {
    status: 200,
    body: "Hello world!",
  };
}

export function welcome(plugName: string) {
  if (plugName !== "core") {
    return;
  }
  console.log("Hello world!!", plugName);
  return "hi";
}
