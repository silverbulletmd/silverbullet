import MarkdownIt from "https://esm.sh/markdown-it@13.0.1";
import {
  getText,
  showPanel,
} from "../../syscall/silverbullet-syscall/editor.ts";
import * as clientStore from "../../syscall/silverbullet-syscall/clientStore.ts";
import { cleanMarkdown } from "./util.ts";

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

table {
  width: 100%;
  border-spacing: 0;
}

thead tr {
    background-color: #333;
    color: #eee;
}

th, td {
    padding: 8px;
}

tbody tr:nth-of-type(even) {
    background-color: #f3f3f3;
}

a[href] {
  text-decoration: none;
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

import taskLists from "https://esm.sh/markdown-it-task-lists@2.1.1";

const md = new MarkdownIt({
  linkify: true,
  html: false,
  typographer: true,
}).use(taskLists);

export async function updateMarkdownPreview() {
  if (!(await clientStore.get("enableMarkdownPreview"))) {
    return;
  }
  let text = await getText();
  let cleanMd = await cleanMarkdown(text);
  await showPanel(
    "rhs",
    2,
    `<html><head>${css}</head><body>${md.render(cleanMd)}</body></html>`,
  );
}
