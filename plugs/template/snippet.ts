import {
  CompleteEvent,
  SlashCompletionOption,
  SlashCompletions,
} from "../../plug-api/types.ts";
import { editor, markdown, space, YAML } from "$sb/syscalls.ts";
import type { AttributeCompletion } from "../index/attributes.ts";
import { queryObjects } from "../index/plug_api.ts";
import { TemplateObject } from "./types.ts";
import { loadPageObject } from "./page.ts";
import { renderTemplate } from "./api.ts";
import {
  extractFrontmatter,
  prepareFrontmatterDispatch,
} from "$sb/lib/frontmatter.ts";
import { SnippetConfig } from "./types.ts";
import { deepObjectMerge } from "$sb/lib/json.ts";

export async function snippetSlashComplete(
  completeEvent: CompleteEvent,
): Promise<SlashCompletions> {
  const allTemplates = await queryObjects<TemplateObject>("template", {
    // where hooks.snippet.slashCommand exists
    filter: ["attr", ["attr", ["attr", "hooks"], "snippet"], "slashCommand"],
  }, 5);
  return {
    options: allTemplates.map((template) => {
      const snippetTemplate = template.hooks!.snippet!;

      return {
        label: snippetTemplate.slashCommand,
        detail: template.description,
        order: snippetTemplate.order || 0,
        templatePage: template.ref,
        pageName: completeEvent.pageName,
        invoke: "template.insertSnippetTemplate",
      };
    }),
  };
}

export async function insertSnippetTemplate(
  slashCompletion: SlashCompletionOption,
) {
  const pageObject = await loadPageObject(
    slashCompletion.pageName || (await editor.getCurrentPage()),
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
    let parsedFrontmatter: Record<string, any> = {};
    try {
      parsedFrontmatter = await YAML.parse(renderedFrontmatter);
    } catch (e: any) {
      console.error(
        `Invalid rendered for ${slashCompletion.templatePage}:`,
        e.message,
        "for frontmatter",
        renderedFrontmatter,
      );
      await editor.flashNotification(
        `Invalid frontmatter for ${slashCompletion.templatePage}, won't insert snippet`,
        "error",
      );
      return;
    }
    const pageText = await editor.getText();
    const tree = await markdown.parseMarkdown(pageText);
    const currentFrontmatter = await extractFrontmatter(
      tree,
      parsedFrontmatter,
    );
    if (!currentFrontmatter.tags?.length) {
      delete currentFrontmatter.tags;
    }
    const newFrontmatter = deepObjectMerge(
      currentFrontmatter,
      parsedFrontmatter,
    );

    const dispatch = await prepareFrontmatterDispatch(
      tree,
      newFrontmatter,
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
    let endOfLine = cursorPos;
    while (endOfLine < pageText.length && pageText[endOfLine] !== "\n") {
      endOfLine++;
    }
    let currentLine = pageText.slice(startOfLine, endOfLine);
    const caretParts = replacementText.split("|^|");
    const emptyLine = !currentLine;
    currentLine = currentLine.replace(matchRegex, caretParts[0]);

    let newSelection = emptyLine
      ? {
        anchor: startOfLine + currentLine.length,
      }
      : undefined;

    if (caretParts.length === 2) {
      // The semantics of a caret in a replacement are:
      // 1. It's a caret, so we need to move the cursor there
      // 2. It's a placeholder, so we need to remove it
      // 3. Any text after the caret should be inserted after the caret
      const caretPos = currentLine.length;
      // Now add the text after the caret
      currentLine += caretParts[1];
      newSelection = {
        anchor: startOfLine + caretPos,
      };
    }

    await editor.dispatch({
      changes: {
        from: startOfLine,
        to: endOfLine,
        insert: currentLine,
      },
      selection: newSelection,
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
