import { esbuild } from "../deps.ts";
import { MediaType } from "./deno.ts";

export function mediaTypeToLoader(mediaType: MediaType): esbuild.Loader {
  switch (mediaType) {
    case "JavaScript":
    case "Mjs":
      return "js";
    case "JSX":
      return "jsx";
    case "TypeScript":
    case "Mts":
      return "ts";
    case "TSX":
      return "tsx";
    case "Json":
      return "js";
    default:
      throw new Error(`Unhandled media type ${mediaType}.`);
  }
}

export function transformRawIntoContent(
  raw: Uint8Array,
  mediaType: MediaType,
): string | Uint8Array {
  switch (mediaType) {
    case "Json":
      return jsonToESM(raw);
    default:
      return raw;
  }
}

function jsonToESM(source: Uint8Array): string {
  const sourceString = new TextDecoder().decode(source);
  let json = JSON.stringify(JSON.parse(sourceString), null, 2);
  json = json.replaceAll(`"__proto__":`, `["__proto__"]:`);
  return `export default ${json};`;
}
