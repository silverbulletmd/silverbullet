import MarkdownIt from "markdown-it";
import { getText, showRhs } from "plugos-silverbullet-syscall/editor";

var taskLists = require("markdown-it-task-lists");

const md = new MarkdownIt({
  linkify: true,
  html: false,
  typographer: true,
}).use(taskLists);

export async function renderMarkdown() {
  let text = await getText();
  let html = md.render(text);
  await showRhs(`<html><body>${html}</body></html>`);
}
