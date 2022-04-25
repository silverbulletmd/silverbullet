import { HighlightStyle, tags as t } from "@codemirror/highlight";
import * as ct from "./customtags";
import { MDExt } from "./markdown_ext";

export default function highlightStyles(mdExtension: MDExt[]) {
  return HighlightStyle.define([
    { tag: t.heading1, class: "h1" },
    { tag: t.heading2, class: "h2" },
    { tag: t.heading3, class: "h3" },
    { tag: t.link, class: "link" },
    { tag: t.meta, class: "meta" },
    { tag: t.quote, class: "quote" },
    { tag: t.monospace, class: "code" },
    { tag: t.url, class: "url" },
    { tag: ct.WikiLinkTag, class: "wiki-link" },
    { tag: ct.WikiLinkPageTag, class: "wiki-link-page" },
    { tag: ct.TaskTag, class: "task" },
    { tag: ct.TaskMarkerTag, class: "task-marker" },
    { tag: ct.CodeInfoTag, class: "code-info" },
    { tag: ct.CommentTag, class: "comment" },
    { tag: ct.CommentMarkerTag, class: "comment-marker" },
    { tag: t.emphasis, class: "emphasis" },
    { tag: t.strong, class: "strong" },
    { tag: t.atom, class: "atom" },
    { tag: t.bool, class: "bool" },
    { tag: t.url, class: "url" },
    { tag: t.inserted, class: "inserted" },
    { tag: t.deleted, class: "deleted" },
    { tag: t.literal, class: "literal" },
    { tag: t.keyword, class: "keyword" },
    { tag: t.list, class: "list" },
    { tag: t.definition, class: "li" },
    { tag: t.string, class: "string" },
    { tag: t.number, class: "number" },
    { tag: [t.regexp, t.escape, t.special(t.string)], class: "string2" },
    { tag: t.variableName, class: "variableName" },
    { tag: t.typeName, class: "typeName" },
    { tag: t.comment, class: "comment" },
    { tag: t.invalid, class: "invalid" },
    { tag: t.processingInstruction, class: "meta" },
    // { tag: t.content, class: "tbl-content" },
    { tag: t.punctuation, class: "punctuation" },
    ...mdExtension.map((mdExt) => {
      return { tag: mdExt.tag, ...mdExt.styles };
    }),
  ]);
}
