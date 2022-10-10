import {
  getPageMeta,
  listPages,
  readPage,
  writePage,
} from "$sb/silverbullet-syscall/space.ts";
import {
  filterBox,
  getCurrentPage,
  getCursor,
  insertAtCursor,
  moveCursor,
  navigate,
  prompt,
} from "../../syscall/silverbullet-syscall/editor.ts";
import { parseMarkdown } from "../../syscall/silverbullet-syscall/markdown.ts";
import { extractMeta } from "../query/data.ts";
import { renderToText } from "../../common/tree.ts";
import { niceDate } from "./dates.ts";
import { readSettings } from "../lib/settings_page.ts";

export async function instantiateTemplateCommand() {
  const allPages = await listPages();
  const { pageTemplatePrefix } = await readSettings({
    pageTemplatePrefix: "template/page/",
  });

  const selectedTemplate = await filterBox(
    "Template",
    allPages
      .filter((pageMeta) => pageMeta.name.startsWith(pageTemplatePrefix))
      .map((pageMeta) => ({
        ...pageMeta,
        name: pageMeta.name.slice(pageTemplatePrefix.length),
      })),
    `Select the template to create a new page from (listing any page starting with <tt>${pageTemplatePrefix}</tt>)`,
  );

  if (!selectedTemplate) {
    return;
  }
  console.log("Selected template", selectedTemplate);

  const { text } = await readPage(
    `${pageTemplatePrefix}${selectedTemplate.name}`,
  );

  const parseTree = await parseMarkdown(text);
  const additionalPageMeta = extractMeta(parseTree, [
    "$name",
    "$disableDirectives",
  ]);

  const pageName = await prompt("Name of new page", additionalPageMeta.$name);
  if (!pageName) {
    return;
  }
  const pageText = replaceTemplateVars(renderToText(parseTree), pageName);
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
    `Select the snippet to insert (listing any page starting with <tt>${snippetPrefix}</tt>)`,
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
  let date = niceDate(new Date());
  let pageName = `${dailyNotePrefix}${date}`;
  if (dailyNoteTemplateText) {
    try {
      await getPageMeta(pageName);
    } catch {
      // Doesn't exist, let's create
      await writePage(
        pageName,
        replaceTemplateVars(dailyNoteTemplateText, pageName),
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
