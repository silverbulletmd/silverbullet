import { listPages, readPage, writePage } from "plugos-silverbullet-syscall/space";
import { filterBox, navigate, prompt } from "plugos-silverbullet-syscall/editor";
import { parseMarkdown } from "plugos-silverbullet-syscall/markdown";
import { extractMeta } from "../query/data";
import { renderToText } from "../../common/tree";
import { niceDate } from "./dates";

const pageTemplatePrefix = `template/page/`;

export async function instantiateTemplateCommand() {
  let allPages = await listPages();
  let allPageTemplates = allPages.filter((pageMeta) =>
    pageMeta.name.startsWith(pageTemplatePrefix)
  );

  let selectedTemplate = await filterBox(
    "Template",
    allPageTemplates,
    "Select the template to create a new page from"
  );

  if (!selectedTemplate) {
    return;
  }
  console.log("Selected template", selectedTemplate);

  let { text } = await readPage(selectedTemplate.name);

  let parseTree = await parseMarkdown(text);
  let additionalPageMeta = extractMeta(parseTree, true);
  console.log("Page meta", additionalPageMeta);

  let pageName = await prompt("Name of new page", additionalPageMeta.name);
  if (!pageName) {
    return;
  }
  let pageText = replaceTemplateVars(renderToText(parseTree));
  await writePage(pageName, pageText);
  await navigate(pageName);
}

export function replaceTemplateVars(s: string): string {
  return s.replaceAll(/\{\{(\w+)\}\}/g, (match, v) => {
    switch (v) {
      case "today":
        return niceDate(new Date());
        break;
    }
    return match;
  });
}
