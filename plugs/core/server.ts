import {
  EndpointRequest,
  EndpointResponse,
} from "../../plugbox/feature/endpoint";

export function endpointTest(req: EndpointRequest): EndpointResponse {
  console.log("I'm running on the server!", req);
  return {
    status: 200,
    body: "Hello world!",
  };
}

export function welcome() {
  console.log("Hello world!");
}
