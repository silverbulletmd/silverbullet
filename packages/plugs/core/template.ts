import {
  listPages,
  readPage,
  writePage,
} from "@plugos/plugos-silverbullet-syscall/space";
import {
  filterBox,
  navigate,
  prompt,
} from "@plugos/plugos-silverbullet-syscall/editor";
import { parseMarkdown } from "@plugos/plugos-silverbullet-syscall/markdown";
import { extractMeta } from "../query/data";
import { renderToText } from "@silverbulletmd/common/tree";
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
  let pageText = replaceTemplateVars(renderToText(parseTree), pageName);
  await writePage(pageName, pageText);
  await navigate(pageName);
}

export function replaceTemplateVars(s: string, pageName: string): string {
  return s.replaceAll(/\{\{([^\}]+)\}\}/g, (match, v) => {
    switch (v) {
      case "today":
        return niceDate(new Date());
      case "yesterday":
        let yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return niceDate(yesterday);
      case "lastWeek":
        let lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        return niceDate(lastWeek);
    }
    return match;
  });
}
