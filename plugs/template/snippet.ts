import { CompleteEvent, SlashCompletion } from "$sb/app_event.ts";
import { editor, markdown, space } from "$sb/syscalls.ts";
import type { AttributeCompletion } from "../index/attributes.ts";
import { queryObjects } from "../index/plug_api.ts";
import { TemplateObject } from "./types.ts";
import { loadPageObject } from "./page.ts";
import { renderTemplate } from "./api.ts";
import { prepareFrontmatterDispatch } from "$sb/lib/frontmatter.ts";
import { SnippetTemplate } from "./types.ts";

export async function snippetSlashComplete(
  completeEvent: CompleteEvent,
): Promise<SlashCompletion[]> {
  const allTemplates = await queryObjects<TemplateObject>("template", {
    // Only return templates that have a trigger and are not expliclty disabled
    filter: ["and", ["attr", ["attr", "hooks"], "snippetTemplate"], ["!=", [
      "attr",
      ["attr", ["attr", "hooks"], "snippetTemplate"],
      "enabled",
    ], [
      "boolean",
      false,
    ]]],
  }, 5);
  return allTemplates.map((template) => {
    const snippetTemplate = template.hooks!.snippetTemplate!;
    if (!snippetTemplate.name) {
      console.error(
        "Snippet template",
        template.ref,
        "has no name specified under hooks.snippetTemplate",
      );
    }
    return {
      label: snippetTemplate.name || "ERROR",
      detail: template.description,
      templatePage: template.ref,
      pageName: completeEvent.pageName,
      invoke: "template.insertSnippetTemplate",
    };
  });
}

export async function insertSnippetTemplate(slashCompletion: SlashCompletion) {
  const pageObject = await loadPageObject(
    slashCompletion.pageName,
  );

  const templateText = await space.readPage(slashCompletion.templatePage);
  let { renderedFrontmatter, text: replacementText, frontmatter } =
    await renderTemplate(
      templateText,
      pageObject,
    );
  const snippetTemplate: SnippetTemplate = frontmatter.hooks!.snippetTemplate!;

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
    // update cursor position
    cursorPos = await editor.getCursor();
  }

  if (snippetTemplate.insertAt) {
    switch (snippetTemplate.insertAt) {
      case "page-start":
        await editor.moveCursor(0);
        break;
      case "page-end":
        await editor.moveCursor((await editor.getText()).length);
        break;
      case "line-start": {
        const pageText = await editor.getText();
        let startOfLine = cursorPos;
        while (startOfLine > 0 && pageText[startOfLine - 1] !== "\n") {
          startOfLine--;
        }
        await editor.moveCursor(startOfLine);
        break;
      }
      case "line-end": {
        const pageText = await editor.getText();
        let endOfLine = cursorPos;
        while (endOfLine < pageText.length && pageText[endOfLine] !== "\n") {
          endOfLine++;
        }
        await editor.moveCursor(endOfLine);
        break;
      }
      default:
        // Deliberate no-op
    }
  }

  cursorPos = await editor.getCursor();

  if (snippetTemplate.matchRegex) {
    const pageText = await editor.getText();
    // Regex matching mode
    const matchRegex = new RegExp(snippetTemplate.matchRegex);

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
