import { editor, handlebars, markdown, space, YAML } from "$sb/syscalls.ts";
import {
  extractFrontmatter,
  prepareFrontmatterDispatch,
} from "$sb/lib/frontmatter.ts";
import { renderToText } from "$sb/lib/tree.ts";
import { niceDate, niceTime } from "$sb/lib/dates.ts";
import { readSettings } from "$sb/lib/settings_page.ts";
import { cleanPageRef } from "$sb/lib/resolve.ts";
import { PageMeta } from "$sb/types.ts";
import { CompleteEvent, SlashCompletion } from "$sb/app_event.ts";
import { getObjectByRef, queryObjects } from "../index/plug_api.ts";
import { TemplateObject } from "./types.ts";
import { renderTemplate } from "./api.ts";

export async function templateSlashComplete(
  completeEvent: CompleteEvent,
): Promise<SlashCompletion[]> {
  const allTemplates = await queryObjects<TemplateObject>("template", {
    // Only return templates that have a trigger
    filter: ["!=", ["attr", "trigger"], ["null"]],
  });
  return allTemplates.map((template) => ({
    label: template.trigger!,
    detail: "template",
    templatePage: template.ref,
    pageName: completeEvent.pageName,
    invoke: "template.insertSlashTemplate",
  }));
}

export async function insertSlashTemplate(slashCompletion: SlashCompletion) {
  const pageObject = await loadPageObject(slashCompletion.pageName);

  const templateText = await space.readPage(slashCompletion.templatePage);
  let { frontmatter, text } = await renderTemplate(templateText, pageObject);

  let cursorPos = await editor.getCursor();

  if (frontmatter) {
    frontmatter = frontmatter.trim();
    const pageText = await editor.getText();
    const tree = await markdown.parseMarkdown(pageText);

    const dispatch = await prepareFrontmatterDispatch(tree, frontmatter);
    if (cursorPos === 0) {
      dispatch.selection = { anchor: frontmatter.length + 9 };
    }
    await editor.dispatch(dispatch);
  }

  cursorPos = await editor.getCursor();
  const carretPos = text.indexOf("|^|");
  text = text.replace("|^|", "");
  await editor.insertAtCursor(text);
  if (carretPos !== -1) {
    await editor.moveCursor(cursorPos + carretPos);
  }
}

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
  const additionalPageMeta = await extractFrontmatter(parseTree, {
    removeKeys: [
      "$name",
      "$disableDirectives",
    ],
  });

  const tempPageMeta: PageMeta = {
    tags: ["page"],
    ref: "",
    name: "",
    created: "",
    lastModified: "",
    perm: "rw",
  };

  if (additionalPageMeta.$name) {
    additionalPageMeta.$name = await replaceTemplateVars(
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

  const pageText = await replaceTemplateVars(
    renderToText(parseTree),
    tempPageMeta,
  );
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
  let templateText = await replaceTemplateVars(text, pageMeta);
  const carretPos = templateText.indexOf("|^|");
  templateText = templateText.replace("|^|", "");
  templateText = await replaceTemplateVars(templateText, pageMeta);
  await editor.insertAtCursor(templateText);
  if (carretPos !== -1) {
    await editor.moveCursor(cursorPos + carretPos);
  }
}

export async function applyPageTemplateCommand() {
  const allPages = await space.listPages();
  const { pageTemplatePrefix } = await readSettings({
    pageTemplatePrefix: "template/page/",
  });
  const cursorPos = await editor.getCursor();
  const page = await editor.getCurrentPage();
  const pageMeta = await space.getPageMeta(page);
  const allSnippets = allPages
    .filter((pageMeta) => pageMeta.name.startsWith(pageTemplatePrefix))
    .map((pageMeta) => ({
      ...pageMeta,
      name: pageMeta.name.slice(pageTemplatePrefix.length),
    }));

  const selectedPage = await editor.filterBox(
    "Page template",
    allSnippets,
    `Select the page template to apply (listing any page starting with <tt>${pageTemplatePrefix}</tt>)`,
  );

  if (!selectedPage) {
    return;
  }

  const text = await space.readPage(
    `${pageTemplatePrefix}${selectedPage.name}`,
  );
  let templateText = await replaceTemplateVars(text, pageMeta);
  const carretPos = templateText.indexOf("|^|");
  templateText = templateText.replace("|^|", "");
  templateText = await replaceTemplateVars(templateText, pageMeta);
  await editor.insertAtCursor(templateText);
  if (carretPos !== -1) {
    await editor.moveCursor(cursorPos + carretPos);
  }
}

export async function loadPageObject(pageName?: string): Promise<PageMeta> {
  if (!pageName) {
    return {
      ref: "",
      name: "",
      tags: ["page"],
      lastModified: "",
      created: "",
    } as PageMeta;
  }
  return (await getObjectByRef<PageMeta>(
    pageName,
    "page",
    pageName,
  )) || {
    ref: pageName,
    name: pageName,
    tags: ["page"],
    lastModified: "",
    created: "",
  } as PageMeta;
}

export function replaceTemplateVars(
  s: string,
  pageMeta: PageMeta,
): Promise<string> {
  return handlebars.renderTemplate(s, {}, { page: pageMeta });
}

export async function quickNoteCommand() {
  const { quickNotePrefix } = await readSettings({
    quickNotePrefix: "📥 ",
  });
  const date = niceDate(new Date());
  const time = niceTime(new Date());
  const pageName = `${quickNotePrefix}${date} ${time}`;
  await editor.navigate(pageName);
}

export async function dailyNoteCommand() {
  const { dailyNoteTemplate, dailyNotePrefix } = await readSettings({
    dailyNoteTemplate: "[[template/page/Daily Note]]",
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
      dailyNoteTemplateText = await space.readPage(
        cleanPageRef(dailyNoteTemplate),
      );
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
      await replaceTemplateVars(dailyNoteTemplateText, {
        tags: ["page"],
        ref: pageName,
        name: pageName,
        created: "",
        lastModified: "",
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
      weeklyNoteTemplate: "[[template/page/Weekly Note]]",
      weeklyNotePrefix: "🗓️ ",
      weeklyNoteMonday: false,
    });
  let weeklyNoteTemplateText = "";
  try {
    weeklyNoteTemplateText = await space.readPage(
      cleanPageRef(weeklyNoteTemplate),
    );
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
        await replaceTemplateVars(weeklyNoteTemplateText, {
          name: pageName,
          ref: pageName,
          tags: ["page"],
          created: "",
          lastModified: "",
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
  const pageMeta = await loadPageObject(page);
  let templateText: string = cmdDef.value;
  const carretPos = templateText.indexOf("|^|");
  templateText = templateText.replace("|^|", "");
  templateText = await replaceTemplateVars(templateText, pageMeta);
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
