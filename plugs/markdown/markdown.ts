import MarkdownIt from "markdown-it";
import { syscall } from "../lib/syscall";

var taskLists = require("markdown-it-task-lists");

const md = new MarkdownIt({
  linkify: true,
  html: false,
  typographer: true,
}).use(taskLists);

export async function renderMarkdown() {
  let text = await syscall("editor.getText");
  let html = md.render(text);
  await syscall("editor.showRhs", `<html><body>${html}</body></html>`);
}
