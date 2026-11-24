import type { Language } from "@codemirror/language";
import {
  encodeLinkText,
  encodePageURI,
  encodeRef,
  type Path,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  type PathIndex,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve_path";
import { extractHashtag } from "@silverbulletmd/silverbullet/lib/tags";
import {
  isBuiltinPath,
  isLocalURL,
  resolveMarkdownLink,
  stripMarkdownLinkBrackets,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  findNodeOfType,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { tagPrefix } from "../../plugs/index/constants.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { Fragment, renderHtml, type Tag } from "./html_render.ts";
import { wikiLinkTag } from "./inline_tags.ts";
import { sanitizeTag } from "./sanitize_html.ts";

const inlineTags: Record<string, string> = {
  Emphasis: "em",
  StrongEmphasis: "strong",
  Strikethrough: "del",
  Highlight: "mark",
};

const containers = new Set([
  "Document",
  "Paragraph",
  "Blockquote",
  "BulletList",
  "OrderedList",
  "ListItem",
  "Task",
  "Table",
  "TableHeader",
  "TableRow",
  "TableCell",
]);

function linkHref(url: string, sourcePage: string): string {
  url = stripMarkdownLinkBrackets(url);
  if (url.startsWith("//") || !isLocalURL(url)) return url;
  if (url.startsWith("#")) return `/${encodePageURI(sourcePage)}${url}`;
  return `/${resolveMarkdownLink(sourcePage, url)}`;
}

type SummarySource = { page: string; files?: PathIndex; language: Language };

function project(node: ParseTree, source: SummarySource): Tag {
  if (!node.type) return node.text ?? "";
  const children = (nodes: ParseTree[] = []) =>
    nodes.map((child) => project(child, source));
  const inline = inlineTags[node.type];
  if (inline) return { name: inline, body: children(node.children) };
  if (containers.has(node.type) || /^(ATX|Setext)Heading\d$/.test(node.type)) {
    return { name: Fragment, body: [" ", ...children(node.children), " "] };
  }
  switch (node.type) {
    case "LuaDirective":
      return { name: "span", attrs: { class: "sb-lua-directive" }, body: "…" };
    case "InlineCode":
      return {
        name: "code",
        attrs: { class: "sb-code" },
        body: children(node.children),
      };
    case "Escape":
      return renderToText(node).slice(1);
    case "HardBreak":
      return " ";
    case "Hashtag": {
      // Drawn as the same tag pill the rendered page shows
      const tagText = renderToText(node);
      const tagName = extractHashtag(tagText);
      const link = tagPrefix + tagName;
      return {
        name: "a",
        attrs: {
          class: "hashtag sb-hashtag",
          "data-tag-name": tagName,
          href: `/${encodePageURI(link)}`,
          "data-ref": link,
        },
        body: tagText,
      };
    }
    case "AtMention":
    case "Entity":
      return renderToText(node);
    case "WikiLink": {
      const link = wikiLinkTag(node, false, children);
      if (typeof link === "string" || !link.attrs?.["data-ref"]) return link;
      const alias = findNodeOfType(node, "WikiLinkAlias");
      if (alias && typeof link.body === "string" && link.body.includes("${")) {
        const paragraph = parse(source.language, link.body).children?.find(
          (child) => child.type === "Paragraph",
        );
        if (paragraph?.children) link.body = children(paragraph.children);
      }
      const ref = parseToRef(link.attrs["data-ref"]);
      if (!ref) return link;
      const from = `${source.page}.md` as Path;
      if (!ref.path) {
        ref.path = from;
      } else if (source.files && !isBuiltinPath(ref.path)) {
        ref.path = resolvePath(ref.path, from, source.files).path;
      }
      link.attrs["data-ref"] = encodeLinkText(ref);
      link.attrs.href = `/${encodePageURI(encodeRef(ref))}`;
      return link;
    }
    case "Link":
    case "Image": {
      const parts = node.children ?? [];
      const end = parts.findIndex(
        (part) => part.type === "LinkMark" && renderToText(part) === "]",
      );
      const label = children(parts.slice(1, end === -1 ? undefined : end));
      const url = parts.find((part) => part.type === "URL");
      if (node.type === "Image" || !url) return { name: Fragment, body: label };
      return {
        name: "a",
        attrs: {
          href: linkHref(renderToText(url), source.page),
          target: "_blank",
        },
        body: label,
      };
    }
    case "Autolink":
    case "NakedURL": {
      const url = renderToText(findNodeOfType(node, "URL") ?? node);
      return {
        name: "a",
        attrs: { href: linkHref(url, source.page), target: "_blank" },
        body: url,
      };
    }
    default:
      return "";
  }
}

function mapText(
  tag: Tag,
  fn: (text: string, expression: boolean) => string,
): Tag {
  if (typeof tag === "string") return fn(tag, false);
  const body =
    typeof tag.body === "string"
      ? fn(tag.body, tag.attrs?.class === "sb-lua-directive")
      : tag.body.map((child) => mapText(child, fn)).filter(Boolean);
  if (!body.length) return "";
  // The space separating an element from the text before it goes outside
  // it, or a link would underline it and a tag pill would pad it
  if (tag.name !== Fragment && typeof body === "string" && body[0] === " ") {
    return { name: Fragment, body: [" ", { ...tag, body: body.slice(1) }] };
  }
  return { ...tag, body };
}

export function renderMarkdownSummary(
  text: string,
  source: SummarySource,
  maxChars = 160,
): string {
  let pendingSpace = false;
  let length = 0;
  let hasText = false;
  const normalized = mapText(
    project(parse(source.language, text), source),
    (text, expression) => {
      const words = text.match(/\S+/gu);
      if (!words) {
        pendingSpace ||= text.length > 0;
        return "";
      }
      const prefix =
        length > 0 && (pendingSpace || /^\s/u.test(text)) ? " " : "";
      pendingSpace = /\s$/u.test(text);
      const visible = prefix + words.join(" ");
      length += [...visible].length;
      hasText ||= !expression;
      return visible;
    },
  );
  if (!hasText || maxChars <= 0) return "";
  if (length <= maxChars) return renderHtml(sanitizeTag(normalized));

  let remaining = maxChars - 1;
  const shortened = mapText(normalized, (text) => {
    if (remaining <= 0) return "";
    const chars = [...text];
    const visible = chars.slice(0, remaining).join("");
    remaining -= chars.length;
    return remaining <= 0 ? visible.trimEnd() : visible;
  });
  return renderHtml(sanitizeTag(shortened)).trimEnd() + "…";
}
