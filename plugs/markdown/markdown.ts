import MarkdownIt from "markdown-it";
import { getText, hideRhs, showRhs } from "plugos-silverbullet-syscall/editor";
import * as clientStore from "plugos-silverbullet-syscall/clientStore";
import { parseMarkdown } from "plugos-silverbullet-syscall/markdown";
import { renderMarkdown, replaceNodesMatching } from "../lib/tree";

const css = `
<style>
body {
  font-family: georgia,times,serif;
  font-size: 14pt;
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
  padding-left: 20px;
  padding-right: 20px;
}
blockquote {
  border-left: 1px solid #333;
  margin-left: 2px;
  padding-left: 10px;
}

hr {
    margin: 1em 0 1em 0;
    text-align: center;
    border-color: #777;
    border-width: 0;
    border-style: dotted;
}

hr:after {
    content: "···";
    letter-spacing: 1em;
}

</style>
`;

var taskLists = require("markdown-it-task-lists");

const md = new MarkdownIt({
  linkify: true,
  html: false,
  typographer: true,
}).use(taskLists);

export async function togglePreview() {
  let currentValue = !!(await clientStore.get("enableMarkdownPreview"));
  await clientStore.set("enableMarkdownPreview", !currentValue);
  if (!currentValue) {
    updateMarkdownPreview();
  } else {
    hideMarkdownPreview();
  }
}

function encodePageUrl(name: string): string {
  return name.replaceAll(" ", "_");
}

export async function cleanMarkdown(text: string) {
  let mdTree = await parseMarkdown(text);
  replaceNodesMatching(mdTree, (n) => {
    if (n.type === "WikiLink") {
      const page = n.children![1].children![0].text!;
      return {
        // HACK
        text: `[${page}](/${encodePageUrl(page)})`,
      };
    }
    // Simply get rid of these
    if (n.type === "CommentBlock" || n.type === "Comment") {
      return null;
    }
  });
  let html = md.render(renderMarkdown(mdTree));
  return html;
}

export async function updateMarkdownPreview() {
  if (!(await clientStore.get("enableMarkdownPreview"))) {
    return;
  }
  let text = await getText();
  let html = await cleanMarkdown(text);
  await showRhs(`<html><head>${css}</head><body>${html}</body></html>`, 2);
}

async function hideMarkdownPreview() {
  await hideRhs();
}
