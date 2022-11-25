import { editor, markdown, system } from "$sb/silverbullet-syscall/mod.ts";
import { nodeAtPos } from "$sb/lib/tree.ts";
import { replaceAsync } from "$sb/lib/util.ts";
import { directiveRegex, renderDirectives } from "./directives.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";

export async function updateDirectivesOnPageCommand(arg: any) {
  // If `arg` is a string, it's triggered automatically via an event, not explicitly via a command
  const explicitCall = typeof arg !== "string";
  const pageName = await editor.getCurrentPage();
  const text = await editor.getText();
  const tree = await markdown.parseMarkdown(text);
  const metaData = extractFrontmatter(tree, ["$disableDirectives"]);
  if (metaData.$disableDirectives) {
    // Not updating, directives disabled
    return;
  }

  // If this page is shared ($share) via collab: disable directives as well
  // due to security concerns
  if (metaData.$share) {
    for (const uri of metaData.$share) {
      if (uri.startsWith("collab:")) {
        if (explicitCall) {
          await editor.flashNotification(
            "Directives are disabled for 'collab' pages (safety reasons).",
            "error",
          );
        }
        return;
      }
    }
  }

  // Collect all directives and their body replacements
  const replacements: { fullMatch: string; text?: string }[] = [];

  // Sanity checking if the server gives useful responses (will not be the case on silverbullet.md)
  try {
    await system.invokeFunction("server", "serverPing");
  } catch {
    console.warn("Server not functional, not updating directives");
    return;
  }

  await replaceAsync(
    text,
    directiveRegex,
    async (fullMatch, startInst, _type, _arg, _body, endInst, index) => {
      const replacement: { fullMatch: string; text?: string } = { fullMatch };
      // Pushing to the replacement array
      const currentNode = nodeAtPos(tree, index + 1);
      if (currentNode?.type !== "CommentBlock") {
        // If not a comment block, it's likely a code block, ignore
        // console.log("Not comment block, ignoring", fullMatch);
        return fullMatch;
      }
      replacements.push(replacement);
      try {
        const replacementText = await system.invokeFunction(
          "server",
          "serverRenderDirective",
          pageName,
          fullMatch,
        );
        replacement.text = replacementText;
        // Return value is ignored, we're using the replacements array
        return fullMatch;
      } catch (e: any) {
        replacement.text = `${startInst}\n**ERROR:** ${e.message}\n${endInst}`;
        // Return value is ignored, we're using the replacements array
        return fullMatch;
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
    const from = index, to = index + replacement.fullMatch.length;
    if (text.substring(from, to) === replacement.text) {
      // No change, skip
      continue;
    }
    await editor.dispatch({
      changes: {
        from,
        to,
        insert: replacement.text,
      },
    });
  }
}

export function serverPing() {
  return "pong";
}

// Called from client, running on server
// The text passed here is going to be a single directive block (not a full page)
export function serverRenderDirective(
  pageName: string,
  text: string,
): Promise<string> {
  return renderDirectives(pageName, text);
}
