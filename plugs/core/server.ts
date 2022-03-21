import { EndpointRequest, EndpointResponse } from "../../plugbox/endpoints";

export function endpointTest(req: EndpointRequest): EndpointResponse {
  console.log("I'm running on the server!", req);
  return {
    status: 200,
    body: "Hello world!",
  };
}

export function welcome() {
  for (var i = 0; i < 10; i++) {
    console.log("Welcome to you all!!!");
  }
}
