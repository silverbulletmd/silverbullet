import { CompleteEvent, SlashCompletion } from "$sb/app_event.ts";
import { editor, markdown, space } from "$sb/syscalls.ts";
import type { AttributeCompletion } from "../index/attributes.ts";
import { queryObjects } from "../index/plug_api.ts";
import { TemplateObject } from "./types.ts";
import { loadPageObject } from "./page.ts";
import { renderTemplate } from "./api.ts";
import { prepareFrontmatterDispatch } from "$sb/lib/frontmatter.ts";
import { SnippetConfig } from "./types.ts";

export async function snippetSlashComplete(
  completeEvent: CompleteEvent,
): Promise<SlashCompletion[]> {
  const allTemplates = await queryObjects<TemplateObject>("template", {
    // where hooks.snippet.slashCommand exists
    filter: ["attr", ["attr", ["attr", "hooks"], "snippet"], "slashCommand"],
  }, 5);
  return allTemplates.map((template) => {
    const snippetTemplate = template.hooks!.snippet!;

    return {
      label: snippetTemplate.slashCommand,
      detail: template.description,
      order: snippetTemplate.order || 0,
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
      { page: pageObject },
    );
  let snippetTemplate: SnippetConfig;
  try {
    snippetTemplate = SnippetConfig.parse(frontmatter.hooks!.snippet!);
  } catch (e: any) {
    console.error(
      `Invalid template configuration for ${slashCompletion.templatePage}:`,
      e.message,
    );
    await editor.flashNotification(
      `Invalid template configuration for ${slashCompletion.templatePage}, won't insert snippet`,
      "error",
    );
    return;
  }

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

  if (snippetTemplate.match || snippetTemplate.matchRegex) {
    const pageText = await editor.getText();
    // Regex matching mode
    const matchRegex = new RegExp(
      (snippetTemplate.match || snippetTemplate.matchRegex)!,
    );

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
