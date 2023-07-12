import { editor, markdown, space } from "$sb/silverbullet-syscall/mod.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { renderToText } from "$sb/lib/tree.ts";
import { niceDate } from "$sb/lib/dates.ts";
import { readSettings } from "$sb/lib/settings_page.ts";
import { PageMeta } from "../../web/types.ts";
import { buildHandebarOptions } from "../directive/util.ts";

import Handlebars from "handlebars";

export async function instantiateTemplateCommand() {
  const allPages = await space.listPages();
  const { pageTemplatePrefix } = await readSettings({
    pageTemplatePrefix: "template/page/",
  });

  const selectedTemplate = await editor.filterBox(
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

  const text = await space.readPage(
    `${pageTemplatePrefix}${selectedTemplate.name}`,
  );

  const parseTree = await markdown.parseMarkdown(text);
  const additionalPageMeta = await extractFrontmatter(parseTree, [
    "$name",
    "$disableDirectives",
  ]);

  const tempPageMeta: PageMeta = {
    name: "",
    lastModified: 0,
    perm: "rw",
  };

  if (additionalPageMeta.$name) {
    additionalPageMeta.$name = replaceTemplateVars(
      additionalPageMeta.$name,
      tempPageMeta,
    );
  }

  const pageName = await editor.prompt(
    "Name of new page",
    additionalPageMeta.$name,
  );
  if (!pageName) {
    return;
  }
  tempPageMeta.name = pageName;

  try {
    // Fails if doesn't exist
    await space.getPageMeta(pageName);

    // So, page exists, let's warn
    if (
      !await editor.confirm(
        `Page ${pageName} already exists, are you sure you want to override it?`,
      )
    ) {
      return;
    }
  } catch {
    // The preferred scenario, let's keep going
  }

  const pageText = replaceTemplateVars(renderToText(parseTree), tempPageMeta);
  await space.writePage(pageName, pageText);
  await editor.navigate(pageName);
}

export async function insertSnippet() {
  const allPages = await space.listPages();
  const { snippetPrefix } = await readSettings({
    snippetPrefix: "snippet/",
  });
  const cursorPos = await editor.getCursor();
  const page = await editor.getCurrentPage();
  const pageMeta = await space.getPageMeta(page);
  const allSnippets = allPages
    .filter((pageMeta) => pageMeta.name.startsWith(snippetPrefix))
    .map((pageMeta) => ({
      ...pageMeta,
      name: pageMeta.name.slice(snippetPrefix.length),
    }));

  const selectedSnippet = await editor.filterBox(
    "Snippet",
    allSnippets,
    `Select the snippet to insert (listing any page starting with <tt>${snippetPrefix}</tt>)`,
  );

  if (!selectedSnippet) {
    return;
  }

  const text = await space.readPage(`${snippetPrefix}${selectedSnippet.name}`);
  let templateText = replaceTemplateVars(text, pageMeta);
  const carretPos = templateText.indexOf("|^|");
  templateText = templateText.replace("|^|", "");
  templateText = replaceTemplateVars(templateText, pageMeta);
  await editor.insertAtCursor(templateText);
  if (carretPos !== -1) {
    await editor.moveCursor(cursorPos + carretPos);
  }
}

// TODO: This should probably be replaced with handlebards somehow?
export function replaceTemplateVars(s: string, pageMeta: PageMeta): string {
  const template = Handlebars.compile(s, { noEscape: true });
  return template({}, buildHandebarOptions(pageMeta));
}

export async function quickNoteCommand() {
  const { quickNotePrefix } = await readSettings({
    quickNotePrefix: "📥 ",
  });
  const isoDate = new Date().toISOString();
  let [date, time] = isoDate.split("T");
  time = time.split(".")[0];
  const pageName = `${quickNotePrefix}${date} ${time}`;
  await editor.navigate(pageName);
}

export async function dailyNoteCommand() {
  const { dailyNoteTemplate, dailyNotePrefix } = await readSettings({
    dailyNoteTemplate: "template/page/Daily Note",
    dailyNotePrefix: "📅 ",
  });
  const date = niceDate(new Date());
  const pageName = `${dailyNotePrefix}${date}`;
  let carretPos = 0;

  try {
    await space.getPageMeta(pageName);
  } catch {
    // Doesn't exist, let's create
    let dailyNoteTemplateText = "";
    try {
      dailyNoteTemplateText = await space.readPage(dailyNoteTemplate);
      carretPos = dailyNoteTemplateText.indexOf("|^|");
      if (carretPos === -1) {
        carretPos = 0;
      }
      dailyNoteTemplateText = dailyNoteTemplateText.replace("|^|", "");
    } catch {
      console.warn(`No daily note template found at ${dailyNoteTemplate}`);
    }

    await space.writePage(
      pageName,
      replaceTemplateVars(dailyNoteTemplateText, {
        name: pageName,
        lastModified: 0,
        perm: "rw",
      }),
    );
  }
  await editor.navigate(pageName, carretPos);
}

function getWeekStartDate(monday = false) {
  const d = new Date();
  const day = d.getDay();
  let diff = d.getDate() - day;
  if (monday) {
    diff += day == 0 ? -6 : 1;
  }
  return new Date(d.setDate(diff));
}

export async function weeklyNoteCommand() {
  const { weeklyNoteTemplate, weeklyNotePrefix, weeklyNoteMonday } =
    await readSettings({
      weeklyNoteTemplate: "template/page/Weekly Note",
      weeklyNotePrefix: "🗓️ ",
      weeklyNoteMonday: false,
    });
  let weeklyNoteTemplateText = "";
  try {
    weeklyNoteTemplateText = await space.readPage(weeklyNoteTemplate);
  } catch {
    console.warn(`No weekly note template found at ${weeklyNoteTemplate}`);
  }
  const date = niceDate(getWeekStartDate(weeklyNoteMonday));
  const pageName = `${weeklyNotePrefix}${date}`;
  if (weeklyNoteTemplateText) {
    try {
      await space.getPageMeta(pageName);
    } catch {
      // Doesn't exist, let's create
      await space.writePage(
        pageName,
        replaceTemplateVars(weeklyNoteTemplateText, {
          name: pageName,
          lastModified: 0,
          perm: "rw",
        }),
      );
    }
    await editor.navigate(pageName);
  } else {
    await editor.navigate(pageName);
  }
}

export async function insertTemplateText(cmdDef: any) {
  const cursorPos = await editor.getCursor();
  const page = await editor.getCurrentPage();
  let pageMeta: PageMeta | undefined;
  try {
    pageMeta = await space.getPageMeta(page);
  } catch {
    // Likely page not yet created
    pageMeta = {
      name: page,
      lastModified: -1,
      perm: "rw",
    };
  }
  let templateText: string = cmdDef.value;
  const carretPos = templateText.indexOf("|^|");
  templateText = templateText.replace("|^|", "");
  templateText = replaceTemplateVars(templateText, pageMeta);
  await editor.insertAtCursor(templateText);
  if (carretPos !== -1) {
    await editor.moveCursor(cursorPos + carretPos);
  }
}

export async function applyLineReplace(cmdDef: any) {
  const cursorPos = await editor.getCursor();
  const text = await editor.getText();
  const matchRegex = new RegExp(cmdDef.match);
  let startOfLine = cursorPos;
  while (startOfLine > 0 && text[startOfLine - 1] !== "\n") {
    startOfLine--;
  }
  let currentLine = text.slice(startOfLine, cursorPos);

  const emptyLine = !currentLine;

  currentLine = currentLine.replace(matchRegex, cmdDef.replace);

  await editor.dispatch({
    changes: {
      from: startOfLine,
      to: cursorPos,
      insert: currentLine,
    },
    selection: emptyLine
      ? {
        anchor: startOfLine + currentLine.length,
      }
      : undefined,
  });
}
