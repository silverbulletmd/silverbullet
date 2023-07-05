import type { Context } from "https://edge.netlify.com";

export default function handler(request: Request, context: Context) {
  if (request.headers.get("Accept") === "application/json") {
    return new URL("/index.json", request.url);
  } else {
    return context.next();
  }
}
export const config = { path: "/" };
