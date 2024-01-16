import { editor, handlebars, space } from "$sb/syscalls.ts";
import { niceDate, niceTime } from "$sb/lib/dates.ts";
import { readSettings } from "$sb/lib/settings_page.ts";
import { cleanPageRef } from "$sb/lib/resolve.ts";
import { PageMeta } from "$sb/types.ts";
import { getObjectByRef, queryObjects } from "../index/plug_api.ts";
import { TemplateFrontmatter, TemplateObject } from "./types.ts";
import { renderTemplate } from "./api.ts";

export async function newPageCommand(
  _cmdDef: any,
  templateName?: string,
  askName = true,
) {
  if (!templateName) {
    const allPageTemplates = await queryObjects<TemplateObject>("template", {
      // where hooks.pageTemplate and hooks.pageTemplate.enabled != false
      filter: ["and", ["attr", ["attr", "hooks"], "pageTemplate"], ["!=", [
        "attr",
        ["attr", ["attr", "hooks"], "pageTemplate"],
        "enabled",
      ], [
        "boolean",
        false,
      ]]],
    });
    console.log("All page templates", allPageTemplates);
    const selectedTemplate = await editor.filterBox(
      "Page template",
      allPageTemplates
        .map((pageMeta) => ({
          ...pageMeta,
          name: pageMeta.displayName || pageMeta.ref,
        })),
      `Select the template to create a new page from (listing any page tagged with <tt>#template</tt> and 'page' set as 'type')`,
    );

    if (!selectedTemplate) {
      return;
    }
    templateName = selectedTemplate.ref;
  }
  console.log("Selected template", templateName);

  const templateText = await space.readPage(templateName!);

  const tempPageMeta: PageMeta = {
    tag: "page",
    ref: "",
    name: "",
    created: "",
    lastModified: "",
    perm: "rw",
  };
  // Just used to extract the frontmatter
  const { frontmatter } = await renderTemplate(
    templateText,
    tempPageMeta,
  );

  const templateObject: TemplateFrontmatter = frontmatter!;

  let pageName: string | undefined = await replaceTemplateVars(
    templateObject.hooks!.pageTemplate!.suggestedName || "",
    tempPageMeta,
  );

  const pageTemplate = templateObject.hooks!.pageTemplate!;

  if (askName && pageTemplate.confirm !== false) {
    pageName = await editor.prompt(
      "Name of new page",
      await replaceTemplateVars(
        templateObject.hooks!.pageTemplate!.suggestedName || "",
        tempPageMeta,
      ),
    );
    if (!pageName) {
      return;
    }
  }
  tempPageMeta.name = pageName;

  try {
    // Fails if doesn't exist
    await space.getPageMeta(pageName);

    // So, page exists
    if (pageTemplate.openIfExists) {
      console.log("Page already exists, navigating there");
      await editor.navigate(pageName);
      return;
    }

    // let's warn
    if (
      !await editor.confirm(
        `Page ${pageName} already exists, are you sure you want to override it?`,
      )
    ) {
      // Just navigate there without instantiating
      return editor.navigate(pageName);
    }
  } catch {
    // The preferred scenario, let's keep going
  }

  const { text: pageText, renderedFrontmatter } = await renderTemplate(
    templateText,
    tempPageMeta,
  );
  let fullPageText = renderedFrontmatter
    ? "---\n" + renderedFrontmatter + "---\n" + pageText
    : pageText;
  const carretPos = fullPageText.indexOf("|^|");
  fullPageText = fullPageText.replace("|^|", "");
  await space.writePage(
    pageName,
    fullPageText,
  );
  await editor.navigate(pageName, carretPos !== -1 ? carretPos : undefined);
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
          tag: "page",
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
