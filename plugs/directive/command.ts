import { editor, markdown, system } from "$sb/silverbullet-syscall/mod.ts";
import {
  nodeAtPos,
  ParseTree,
  removeParentPointers,
  renderToText,
  traverseTree,
} from "$sb/lib/tree.ts";
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
  const replacements: { fullMatch: string; textPromise: Promise<string> }[] =
    [];

  const allPromises: Promise<string>[] = [];

  removeParentPointers(tree);

  traverseTree(tree, (tree) => {
    if (tree.type !== "Directive") {
      return false;
    }
    const fullMatch = renderToText(tree);
    try {
      const promise = system.invokeFunction(
        "server",
        "serverRenderDirective",
        pageName,
        tree,
      );
      replacements.push({
        textPromise: promise,
        fullMatch,
      });
      allPromises.push(promise);
    } catch (e: any) {
      replacements.push({
        fullMatch,
        textPromise: Promise.resolve(
          `${renderToText(tree.children![0])}\n**ERROR:** ${e.message}\n${
            renderToText(tree.children![tree.children!.length - 1])
          }`,
        ),
      });
    }
    return true;
  });

  // Wait for all to have processed
  await Promise.all(allPromises);

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
    const newText = await replacement.textPromise;
    if (text.substring(from, to) === newText) {
      // No change, skip
      continue;
    }
    await editor.dispatch({
      changes: {
        from,
        to,
        insert: newText,
      },
    });
  }
}

// Called from client, running on server
// The text passed here is going to be a single directive block (not a full page)
export function serverRenderDirective(
  pageName: string,
  tree: ParseTree,
): Promise<string> {
  return renderDirectives(pageName, tree);
}

// Pure server driven implementation of directive updating
export async function serverUpdateDirectives(
  pageName: string,
  text: string,
) {
  const tree = await markdown.parseMarkdown(text);
  // Collect all directives and their body replacements
  const replacements: { fullMatch: string; textPromise: Promise<string> }[] =
    [];

  const allPromises: Promise<string>[] = [];

  traverseTree(tree, (tree) => {
    if (tree.type !== "Directive") {
      return false;
    }
    const fullMatch = renderToText(tree);
    try {
      const promise = renderDirectives(
        pageName,
        tree,
      );
      replacements.push({
        textPromise: promise,
        fullMatch,
      });
      allPromises.push(promise);
    } catch (e: any) {
      replacements.push({
        fullMatch,
        textPromise: Promise.resolve(
          `${renderToText(tree.children![0])}\n**ERROR:** ${e.message}\n${
            renderToText(tree.children![tree.children!.length - 1])
          }`,
        ),
      });
    }
    return true;
  });

  // Wait for all to have processed
  await Promise.all(allPromises);

  // Iterate again and replace the bodies.
  for (const replacement of replacements) {
    text = text.replace(replacement.fullMatch, await replacement.textPromise);
  }
  return text;
}
