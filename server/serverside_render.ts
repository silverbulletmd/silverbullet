import type { Context } from "hono";
import { utcDateString } from "./util.ts";
import {
  getNameFromPath,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { parse } from "../web/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../web/markdown_parser/parser.ts";
import { renderMarkdownToHtml } from "../web/markdown/markdown_render.ts";
import type { ServerOptions } from "./http_server.ts";
import type { AssetBundle } from "../lib/asset_bundle/bundle.ts";
import { htmlEscape } from "../web/markdown/html_render.ts";
import type { SpacePrimitives } from "../lib/spaces/space_primitives.ts";
import { notFoundError } from "../lib/constants.ts";

// Server-side renders a markdown file to HTML
export async function renderHtmlPage(
  spacePrimitives: SpacePrimitives,
  path: string,
  c: Context,
  options: ServerOptions,
  clientAssetBundle: AssetBundle,
): Promise<Response> {
  const ref = parseToRef(path) ?? parseToRef(options.indexPage)!;

  let html = "";
  let title = "SilverBullet"; // Default to simply SilverBullet initially
  let lastModified = utcDateString(Date.now());
  if (!options.auth && options.readOnly) {
    // Only attempt server-side rendering when this site is not protected by auth and running in read-only mode
    if (isMarkdownPath(ref.path)) {
      title = getNameFromPath(ref.path);
      try {
        const { data, meta } = await spacePrimitives.readFile(
          ref.path,
        );
        lastModified = utcDateString(meta.lastModified);

        if (c.req.header("If-Modified-Since") === lastModified) {
          // Not modified, empty body status 304
          return c.body(null, 304);
        }
        const text = new TextDecoder().decode(data);
        const tree = parse(extendedMarkdownLanguage, text);
        html = renderMarkdownToHtml(tree);
      } catch (e: any) {
        if (e.message !== notFoundError.message) {
          console.error("Error server-side rendering page", e);
        }
      }
    } else {
      // If it it's a file with an extension and it doesn't exist we can't really create a new one/recover
      try {
        await spacePrimitives.getFileMeta(ref.path);
      } catch (e: any) {
        if (e.message !== notFoundError.message) {
          return c.notFound();
        }
      }
    }
  }

  const templateData = {
    TITLE: title,
    DESCRIPTION: stripHtml(html).substring(0, 255),
    CONTENT: html,
    HOST_URL_PREFIX: options.hostUrlPrefix ?? "",
  };

  html = clientAssetBundle.readTextFileSync(".client/index.html");

  // Replace each template variable with its corresponding value
  for (const [key, value] of Object.entries(templateData)) {
    const placeholder = `{{${key}}}`;
    const stringValue = typeof value === "boolean"
      ? (value ? "true" : "false")
      : (key === "DESCRIPTION" ? htmlEscape(value) : String(value));
    html = html.replace(placeholder, stringValue);
  }
  return c.html(
    html,
    200,
    {
      "Last-Modified": lastModified,
    },
  );
}

function stripHtml(html: string): string {
  const regex = /<[^>]*>/g;
  return html.replace(regex, "");
}
