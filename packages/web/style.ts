import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import * as ct from "@silverbulletmd/common/customtags";
import { MDExt } from "@silverbulletmd/common/markdown_ext";

export default function highlightStyles(mdExtension: MDExt[]) {
  const hls = HighlightStyle.define([
    { tag: t.heading1, class: "sb-h1" },
    { tag: t.heading2, class: "sb-h2" },
    { tag: t.heading3, class: "sb-h3" },
    { tag: t.link, class: "sb-link" },
    { tag: t.meta, class: "sb-meta" },
    { tag: t.quote, class: "sb-quote" },
    { tag: t.monospace, class: "sb-code" },
    { tag: t.url, class: "sb-url" },
    { tag: ct.WikiLinkTag, class: "sb-wiki-link" },
    { tag: ct.WikiLinkPageTag, class: "sb-wiki-link-page" },
    { tag: ct.TaskTag, class: "sb-task" },
    { tag: ct.TaskMarkerTag, class: "sb-task-marker" },
    { tag: ct.CodeInfoTag, class: "sb-code-info" },
    { tag: ct.CommentTag, class: "sb-comment" },
    { tag: ct.CommentMarkerTag, class: "sb-comment-marker" },
    { tag: ct.Highlight, class: "sb-highlight" },
    { tag: t.emphasis, class: "sb-emphasis" },
    { tag: t.strong, class: "sb-strong" },
    { tag: t.atom, class: "sb-atom" },
    { tag: t.bool, class: "sb-bool" },
    { tag: t.url, class: "sb-url" },
    { tag: t.inserted, class: "sb-inserted" },
    { tag: t.deleted, class: "sb-deleted" },
    { tag: t.literal, class: "sb-literal" },
    { tag: t.keyword, class: "sb-keyword" },
    { tag: t.list, class: "sb-list" },
    // { tag: t.def, class: "sb-li" },
    { tag: t.string, class: "sb-string" },
    { tag: t.number, class: "sb-number" },
    { tag: [t.regexp, t.escape, t.special(t.string)], class: "sb-string2" },
    { tag: t.variableName, class: "sb-variableName" },
    { tag: t.typeName, class: "sb-typeName" },
    { tag: t.comment, class: "sb-comment" },
    { tag: t.invalid, class: "sb-invalid" },
    { tag: t.processingInstruction, class: "sb-meta" },
    // { tag: t.content, class: "tbl-content" },
    { tag: t.punctuation, class: "sb-punctuation" },
    { tag: ct.HorizontalRuleTag, class: "sb-hr" },
    ...mdExtension.map((mdExt) => {
      return { tag: mdExt.tag, ...mdExt.styles, class: mdExt.className };
    }),
  ]);
  const fn0 = hls.style;
  // Hack: https://discuss.codemirror.net/t/highlighting-that-seems-ignored-in-cm6/4320/16
  // @ts-ignore
  hls.style = (tags) => {
    return fn0(tags || []);
  };

  return hls;
}
