import { editor, markdown, system } from "$sb/silverbullet-syscall/mod.ts";
import { nodeAtPos } from "$sb/lib/tree.ts";
import { replaceAsync } from "$sb/lib/util.ts";
import { directiveRegex, renderDirectives } from "./directives.ts";
import { extractMeta } from "./data.ts";

export async function updateDirectivesOnPageCommand() {
  const pageName = await editor.getCurrentPage();
  const text = await editor.getText();
  const tree = await markdown.parseMarkdown(text);
  const metaData = extractMeta(tree, ["$disableDirectives"]);
  if (metaData.$disableDirectives) {
    // Not updating, directives disabled
    return;
  }

  // Collect all directives and their body replacements
  const replacements: { fullMatch: string; text?: string }[] = [];

  await replaceAsync(
    text,
    directiveRegex,
    async (fullMatch, startInst, _type, _arg, _body, endInst, index) => {
      const replacement: { fullMatch: string; text?: string } = { fullMatch };
      // Pushing to the replacement array
      replacements.push(replacement);
      const currentNode = nodeAtPos(tree, index + 1);
      if (currentNode?.type !== "CommentBlock") {
        // If not a comment block, it's likely a code block, ignore
        // console.log("Not comment block, ingoring", fullMatch);
        return fullMatch;
      }
      try {
        const replacementText = await system.invokeFunction(
          "server",
          "serverRenderDirective",
          pageName,
          fullMatch,
        );
        replacement.text = replacementText;
        return replacementText;
      } catch (e: any) {
        return `${startInst}\n**ERROR:** ${e.message}\n${endInst}`;
      }
    },
  );
  // Iterate again and replace the bodies. Iterating again (not using previous positions)
  // because text may have changed in the mean time (directive processing may take some time)
  // Hypothetically in the mean time directives in text may have been changed/swapped, in which
  // case this will break. This would be a rare edge case, however.
  for (const replacement of replacements) {
    // Fetch the text every time, because dispatch() will have been made changes
    const text = await editor.getText();
    // Determine the current position
    const index = text.indexOf(replacement.fullMatch);

    // This may happen if the query itself, or the user is editing inside the directive block (WHY!?)
    if (index === -1) {
      console.warn(
        "Could not find directive in text, skipping",
        replacement.fullMatch,
      );
      continue;
    }
    await editor.dispatch({
      changes: {
        from: index,
        to: index + replacement.fullMatch.length,
        insert: replacement.text,
      },
    });
  }
}

// Called from client, running on server
// The text passed here is going to be a single directive block (not a full page)
export function serverRenderDirective(
  pageName: string,
  text: string,
): Promise<string> {
  return renderDirectives(pageName, text);
}
