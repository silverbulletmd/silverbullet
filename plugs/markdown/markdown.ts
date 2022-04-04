import MarkdownIt from "markdown-it";
import {getText, hideRhs, showRhs} from "plugos-silverbullet-syscall/editor";
import * as clientStore from "plugos-silverbullet-syscall/clientStore";
import {parseMarkdown} from "plugos-silverbullet-syscall/markdown";
import {addParentPointers, renderMarkdown, replaceNodesMatching,} from "../lib/tree";

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

export async function updateMarkdownPreview() {
  if (!(await clientStore.get("enableMarkdownPreview"))) {
    return;
  }
  let text = await getText();
  let mdTree = await parseMarkdown(text);
  // console.log("The tree", mdTree);
  addParentPointers(mdTree);
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
  await showRhs(`<html><body>${html}</body></html>`, 1);
}

async function hideMarkdownPreview() {
  await hideRhs();
}
