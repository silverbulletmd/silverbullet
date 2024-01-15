import { CompleteEvent, SlashCompletion } from "$sb/app_event.ts";
import { PageMeta } from "$sb/types.ts";
import { editor, events, markdown, space } from "$sb/syscalls.ts";
import type {
  AttributeCompleteEvent,
  AttributeCompletion,
} from "../index/attributes.ts";
import { queryObjects } from "../index/plug_api.ts";
import { TemplateObject } from "./types.ts";
import { loadPageObject } from "./template.ts";
import { renderTemplate } from "./api.ts";
import { prepareFrontmatterDispatch } from "$sb/lib/frontmatter.ts";
import { buildHandebarOptions } from "./util.ts";

export async function templateVariableComplete(completeEvent: CompleteEvent) {
  const match = /\{\{([\w@]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }

  const handlebarOptions = buildHandebarOptions({ name: "" } as PageMeta);
  let allCompletions: any[] = Object.keys(handlebarOptions.helpers).map(
    (name) => ({ label: name, detail: "helper" }),
  );
  allCompletions = allCompletions.concat(
    Object.keys(handlebarOptions.data).map((key) => ({
      label: `@${key}`,
      detail: "global variable",
    })),
  );

  const completions = (await events.dispatchEvent(
    `attribute:complete:_`,
    {
      source: "",
      prefix: match[1],
    } as AttributeCompleteEvent,
  )).flat() as AttributeCompletion[];

  allCompletions = allCompletions.concat(
    attributeCompletionsToCMCompletion(completions),
  );

  return {
    from: completeEvent.pos - match[1].length,
    options: allCompletions,
  };
}

export async function templateSlashComplete(
  completeEvent: CompleteEvent,
): Promise<SlashCompletion[]> {
  const allTemplates = await queryObjects<TemplateObject>("template", {
    // Only return templates that have a trigger and are not expliclty disabled
    filter: ["and", ["attr", "trigger"], ["!=", ["attr", "enabled"], [
      "boolean",
      false,
    ]]],
  }, 5);
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
  let { renderedFrontmatter, text } = await renderTemplate(
    templateText,
    pageObject,
  );

  let cursorPos = await editor.getCursor();

  if (renderedFrontmatter) {
    renderedFrontmatter = renderedFrontmatter.trim();
    const pageText = await editor.getText();
    const tree = await markdown.parseMarkdown(pageText);

    const dispatch = await prepareFrontmatterDispatch(
      tree,
      renderedFrontmatter,
    );
    if (cursorPos === 0) {
      dispatch.selection = { anchor: renderedFrontmatter.length + 9 };
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

export function attributeCompletionsToCMCompletion(
  completions: AttributeCompletion[],
) {
  return completions.map(
    (completion) => ({
      label: completion.name,
      detail: `${completion.attributeType} (${completion.source})`,
      type: "attribute",
    }),
  );
}
