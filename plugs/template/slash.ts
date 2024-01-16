import { CompleteEvent, SlashCompletion } from "$sb/app_event.ts";
import { editor, markdown, space } from "$sb/syscalls.ts";
import type { AttributeCompletion } from "../index/attributes.ts";
import { queryObjects } from "../index/plug_api.ts";
import { TemplateObject } from "./types.ts";
import { loadPageObject } from "./template.ts";
import { renderTemplate } from "./api.ts";
import { prepareFrontmatterDispatch } from "$sb/lib/frontmatter.ts";
import { SlashTemplate } from "./types.ts";

export async function templateSlashComplete(
  completeEvent: CompleteEvent,
): Promise<SlashCompletion[]> {
  const allTemplates = await queryObjects<TemplateObject>("template", {
    // Only return templates that have a trigger and are not expliclty disabled
    filter: ["and", ["attr", ["attr", "hooks"], "slashTemplate"], ["!=", [
      "attr",
      ["attr", ["attr", "hooks"], "slashTemplate"],
      "enabled",
    ], [
      "boolean",
      false,
    ]]],
  }, 5);
  return allTemplates.map((template) => {
    const slashTemplate = template.hooks!.slashTemplate!;
    if (!slashTemplate.name) {
      console.error(
        "Slash template",
        template.ref,
        "has no name specified under hooks.slashTemplate",
      );
    }
    return {
      label: slashTemplate.name || "ERROR",
      detail: template.description,
      templatePage: template.ref,
      pageName: completeEvent.pageName,
      invoke: "template.insertSlashTemplate",
    };
  });
}

export async function insertSlashTemplate(slashCompletion: SlashCompletion) {
  const pageObject = await loadPageObject(
    slashCompletion.pageName,
  );

  const templateText = await space.readPage(slashCompletion.templatePage);
  let { renderedFrontmatter, text: replacementText, frontmatter } =
    await renderTemplate(
      templateText,
      pageObject,
    );
  const slashTemplate: SlashTemplate = frontmatter.hooks!.slashTemplate!;

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

  if (slashTemplate.match) {
    const pageText = await editor.getText();
    // Regex matching mode
    const matchRegex = new RegExp(slashTemplate.match);

    let startOfLine = cursorPos;
    while (startOfLine > 0 && pageText[startOfLine - 1] !== "\n") {
      startOfLine--;
    }
    let currentLine = pageText.slice(startOfLine, cursorPos);
    const emptyLine = !currentLine;
    currentLine = currentLine.replace(matchRegex, replacementText);

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
  } else {
    const carretPos = replacementText.indexOf("|^|");
    replacementText = replacementText.replace("|^|", "");
    await editor.insertAtCursor(replacementText);
    if (carretPos !== -1) {
      await editor.moveCursor(cursorPos + carretPos);
    }
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
