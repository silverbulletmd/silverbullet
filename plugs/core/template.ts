import { listPages, readPage, writePage } from "plugos-silverbullet-syscall/space";
import { filterBox, getCurrentPage, getText, navigate, prompt } from "plugos-silverbullet-syscall/editor";
import { parseMarkdown } from "plugos-silverbullet-syscall/markdown";
import { extractMeta } from "../query/data";
import { renderToText } from "../../common/tree";
import { niceDate } from "./dates";
import { dispatch } from "plugos-syscall/event";
import { invokeFunction } from "plugos-silverbullet-syscall/system";

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
  await invokeFunction(
    "server",
    "instantiateTemplate",
    pageName,
    renderToText(parseTree)
  );
  // let pageText = replaceTemplateVars(, pageName);
  // await writePage(pageName, pageText);
  await navigate(pageName);
}

export async function instantiateTemplate(pageName: string, text: string) {
  let pageText = replaceTemplateVars(text, pageName);
  await writePage(pageName, pageText);
}

export async function replaceTemplateVarsCommand() {
  let currentPage = await getCurrentPage();
  let text = await getText();
  await invokeFunction("server", "instantiateTemplate", currentPage, text);
}

export function replaceTemplateVars(s: string, pageName: string): string {
  return s.replaceAll(/\{\{([^\}]+)\}\}/g, (match, v) => {
    if (v === "today") {
      return niceDate(new Date());
    }
    if (v.startsWith("placeholder:")) {
      // Dispatch event, to be replaced in the file async later
      dispatch(v, {
        pageName: pageName,
        placeholder: v,
      }).catch((e) => {
        console.error("Failed to dispatch placeholder event", e);
      });
    }
    return match;
  });
}
