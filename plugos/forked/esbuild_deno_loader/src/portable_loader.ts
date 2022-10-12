import { esbuild, extname, fromFileUrl } from "../deps.ts";
import * as deno from "./deno.ts";
import { mediaTypeToLoader, transformRawIntoContent } from "./shared.ts";

export interface LoadOptions {
  importMapURL?: URL;
}

export async function load(
  url: URL,
  _options: LoadOptions,
): Promise<esbuild.OnLoadResult | null> {
  switch (url.protocol) {
    case "http:":
    case "https:":
    case "data:":
      return await loadWithFetch(url);
    case "file:": {
      const res = await loadWithReadFile(url);
      res.watchFiles = [fromFileUrl(url.href)];
      return res;
    }
  }
  return null;
}

async function loadWithFetch(
  specifier: URL,
): Promise<esbuild.OnLoadResult> {
  const specifierRaw = specifier.href;

  // TODO(lucacasonato): redirects!
  const resp = await fetch(specifierRaw);
  if (!resp.ok) {
    throw new Error(
      `Encountered status code ${resp.status} while fetching ${specifierRaw}.`,
    );
  }

  const contentType = resp.headers.get("content-type");
  const mediaType = mapContentType(
    new URL(resp.url || specifierRaw),
    contentType,
  );

  const loader = mediaTypeToLoader(mediaType);

  const raw = new Uint8Array(await resp.arrayBuffer());
  const contents = transformRawIntoContent(raw, mediaType);

  return { contents, loader };
}

async function loadWithReadFile(specifier: URL): Promise<esbuild.OnLoadResult> {
  const path = fromFileUrl(specifier);

  const mediaType = mapContentType(specifier, null);
  const loader = mediaTypeToLoader(mediaType);

  const raw = await Deno.readFile(path);
  const contents = transformRawIntoContent(raw, mediaType);

  return { contents, loader };
}

function mapContentType(
  specifier: URL,
  contentType: string | null,
): deno.MediaType {
  if (contentType !== null) {
    const contentTypes = contentType.split(";");
    const mediaType = contentTypes[0].toLowerCase();
    switch (mediaType) {
      case "application/typescript":
      case "text/typescript":
      case "video/vnd.dlna.mpeg-tts":
      case "video/mp2t":
      case "application/x-typescript":
        return mapJsLikeExtension(specifier, "TypeScript");
      case "application/javascript":
      case "text/javascript":
      case "application/ecmascript":
      case "text/ecmascript":
      case "application/x-javascript":
      case "application/node":
        return mapJsLikeExtension(specifier, "JavaScript");
      case "text/jsx":
        return "JSX";
      case "text/tsx":
        return "TSX";
      case "application/json":
      case "text/json":
        return "Json";
      case "application/wasm":
        return "Wasm";
      case "text/plain":
      case "application/octet-stream":
        return mediaTypeFromSpecifier(specifier);
      default:
        return "Unknown";
    }
  } else {
    return mediaTypeFromSpecifier(specifier);
  }
}

function mapJsLikeExtension(
  specifier: URL,
  defaultType: deno.MediaType,
): deno.MediaType {
  const path = specifier.pathname;
  switch (extname(path)) {
    case ".jsx":
      return "JSX";
    case ".mjs":
      return "Mjs";
    case ".cjs":
      return "Cjs";
    case ".tsx":
      return "TSX";
    case ".ts":
      if (path.endsWith(".d.ts")) {
        return "Dts";
      } else {
        return defaultType;
      }
    case ".mts": {
      if (path.endsWith(".d.mts")) {
        return "Dmts";
      } else {
        return defaultType == "JavaScript" ? "Mjs" : "Mts";
      }
    }
    case ".cts": {
      if (path.endsWith(".d.cts")) {
        return "Dcts";
      } else {
        return defaultType == "JavaScript" ? "Cjs" : "Cts";
      }
    }
    default:
      return defaultType;
  }
}

function mediaTypeFromSpecifier(specifier: URL): deno.MediaType {
  const path = specifier.pathname;
  switch (extname(path)) {
    case "":
      if (path.endsWith("/.tsbuildinfo")) {
        return "TsBuildInfo";
      } else {
        return "Unknown";
      }
    case ".ts":
      if (path.endsWith(".d.ts")) {
        return "Dts";
      } else {
        return "TypeScript";
      }
    case ".mts":
      if (path.endsWith(".d.mts")) {
        return "Dmts";
      } else {
        return "Mts";
      }
    case ".cts":
      if (path.endsWith(".d.cts")) {
        return "Dcts";
      } else {
        return "Cts";
      }
    case ".tsx":
      return "TSX";
    case ".js":
      return "JavaScript";
    case ".jsx":
      return "JSX";
    case ".mjs":
      return "Mjs";
    case ".cjs":
      return "Cjs";
    case ".json":
      return "Json";
    case ".wasm":
      return "Wasm";
    case ".tsbuildinfo":
      return "TsBuildInfo";
    case ".map":
      return "SourceMap";
    default:
      return "Unknown";
  }
}
