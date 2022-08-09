import {
  listPages,
  readPage,
  writePage,
  getPageMeta,
} from "@silverbulletmd/plugos-silverbullet-syscall/space";
import {
  filterBox,
  getCurrentPage,
  getCursor,
  insertAtCursor,
  moveCursor,
  navigate,
  prompt,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { extractMeta } from "../query/data";
import { renderToText } from "@silverbulletmd/common/tree";
import { niceDate } from "./dates";
import { readSettings } from "../lib/settings_page";

export async function instantiateTemplateCommand() {
  let allPages = await listPages();
  let { pageTemplatePrefix } = await readSettings({
    pageTemplatePrefix: "template/page/",
  });

  let selectedTemplate = await filterBox(
    "Template",
    allPages
      .filter((pageMeta) => pageMeta.name.startsWith(pageTemplatePrefix))
      .map((pageMeta) => ({
        ...pageMeta,
        name: pageMeta.name.slice(pageTemplatePrefix.length),
      })),
    `Select the template to create a new page from (listing any page starting with <tt>${pageTemplatePrefix}</tt>)`
  );

  if (!selectedTemplate) {
    return;
  }
  console.log("Selected template", selectedTemplate);

  let { text } = await readPage(
    `${pageTemplatePrefix}${selectedTemplate.name}`
  );

  let parseTree = await parseMarkdown(text);
  let additionalPageMeta = extractMeta(parseTree, [
    "$name",
    "$disableDirectives",
  ]);

  let pageName = await prompt("Name of new page", additionalPageMeta.$name);
  if (!pageName) {
    return;
  }
  let pageText = replaceTemplateVars(renderToText(parseTree), pageName);
  await writePage(pageName, pageText);
  await navigate(pageName);
}

export async function insertSnippet() {
  let allPages = await listPages();
  let { snippetPrefix } = await readSettings({
    snippetPrefix: "snippet/",
  });
  let cursorPos = await getCursor();
  let page = await getCurrentPage();
  let allSnippets = allPages
    .filter((pageMeta) => pageMeta.name.startsWith(snippetPrefix))
    .map((pageMeta) => ({
      ...pageMeta,
      name: pageMeta.name.slice(snippetPrefix.length),
    }));

  let selectedSnippet = await filterBox(
    "Snippet",
    allSnippets,
    `Select the snippet to insert (listing any page starting with <tt>${snippetPrefix}</tt>)`
  );

  if (!selectedSnippet) {
    return;
  }
  let { text } = await readPage(`${snippetPrefix}${selectedSnippet.name}`);

  let templateText = replaceTemplateVars(text, page);
  let carretPos = templateText.indexOf("|^|");
  templateText = templateText.replace("|^|", "");
  templateText = replaceTemplateVars(templateText, page);
  await insertAtCursor(templateText);
  if (carretPos !== -1) {
    await moveCursor(cursorPos + carretPos);
  }
}

// TODO: This should probably be replaced with handlebards somehow?
export function replaceTemplateVars(s: string, pageName: string): string {
  return s.replaceAll(/\{\{([^\}]+)\}\}/g, (match, v) => {
    switch (v) {
      case "today":
        return niceDate(new Date());
      case "tomorrow":
        let tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return niceDate(tomorrow);
      case "yesterday":
        let yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return niceDate(yesterday);
      case "lastWeek":
        let lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        return niceDate(lastWeek);
      case "page":
        return pageName;
    }
    return match;
  });
}

export async function quickNoteCommand() {
  let { quickNotePrefix } = await readSettings({
    quickNotePrefix: "📥 ",
  });
  let isoDate = new Date().toISOString();
  let [date, time] = isoDate.split("T");
  time = time.split(".")[0];
  let pageName = `${quickNotePrefix}${date} ${time}`;
  await navigate(pageName);
}

export async function dailyNoteCommand() {
  let { dailyNoteTemplate, dailyNotePrefix } = await readSettings({
    dailyNoteTemplate: "template/page/Daily Note",
    dailyNotePrefix: "📅 ",
  });
  let dailyNoteTemplateText = "";
  try {
    let { text } = await readPage(dailyNoteTemplate);
    dailyNoteTemplateText = text;
  } catch {
    console.warn(`No daily note template found at ${dailyNoteTemplate}`);
  }
  let isoDate = new Date().toISOString();
  let date = isoDate.split("T")[0];
  let pageName = `${dailyNotePrefix}${date}`;
  if (dailyNoteTemplateText) {
    try {
      await getPageMeta(pageName);
    } catch {
      // Doesn't exist, let's create
      await writePage(
        pageName,
        replaceTemplateVars(dailyNoteTemplateText, pageName)
      );
    }
    await navigate(pageName);
  } else {
    await navigate(pageName);
  }
}

export async function insertTemplateText(cmdDef: any) {
  let cursorPos = await getCursor();
  let page = await getCurrentPage();
  let templateText: string = cmdDef.value;
  let carretPos = templateText.indexOf("|^|");
  templateText = templateText.replace("|^|", "");
  templateText = replaceTemplateVars(templateText, page);
  await insertAtCursor(templateText);
  if (carretPos !== -1) {
    await moveCursor(cursorPos + carretPos);
  }
}
