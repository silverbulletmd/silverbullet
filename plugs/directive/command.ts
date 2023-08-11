import { editor, markdown, space, sync } from "$sb/silverbullet-syscall/mod.ts";
import {
  ParseTree,
  removeParentPointers,
  renderToText,
  traverseTree,
} from "$sb/lib/tree.ts";
import { renderDirectives } from "./directives.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { PageMeta } from "../../web/types.ts";
import { isFederationPath } from "$sb/lib/resolve.ts";
import { mq } from "$sb/plugos-syscall/mod.ts";
import { Message } from "$sb/types.ts";
import { sleep } from "../../common/async_util.ts";

const directiveUpdateQueueName = "directiveUpdateQueue";

export async function updateDirectivesOnPageCommand() {
  // If `arg` is a string, it's triggered automatically via an event, not explicitly via a command
  const currentPage = await editor.getCurrentPage();
  const pageMeta = await space.getPageMeta(currentPage);
  const text = await editor.getText();
  const tree = await markdown.parseMarkdown(text);
  const metaData = await extractFrontmatter(tree, ["$disableDirectives"]);

  if (isFederationPath(currentPage)) {
    console.info("Current page is a federation page, not updating directives.");
    return;
  }

  if (metaData.$disableDirectives) {
    console.info("Directives disabled in page meta, not updating them.");
    return;
  }

  if (!(await sync.hasInitialSyncCompleted())) {
    console.info(
      "Initial sync hasn't completed yet, not updating directives.",
    );
    return;
  }

  await editor.save();

  const replacements = await findReplacements(tree, text, pageMeta);

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
        "Text I got",
        text,
      );
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

export async function updateDirectivesInSpaceCommand() {
  await editor.flashNotification(
    "Updating directives in entire space, this can take a while...",
  );
  await updateDirectivesInSpace();

  // And notify the user
  await editor.flashNotification("Updating of all directives completed!");
}

export async function processUpdateQueue(messages: Message[]) {
  for (const message of messages) {
    const pageName: string = message.body;
    console.log("Updating directives in page", pageName);
    await updateDirectivesForPage(pageName);
    await mq.ack(directiveUpdateQueueName, message.id);
  }
}

async function findReplacements(
  tree: ParseTree,
  text: string,
  pageMeta: PageMeta,
) {
  // Collect all directives and their body replacements
  const replacements: { fullMatch: string; textPromise: Promise<string> }[] =
    [];

  // Convenience array to wait for all promises to resolve
  const allPromises: Promise<string>[] = [];

  removeParentPointers(tree);

  traverseTree(tree, (tree) => {
    if (tree.type !== "Directive") {
      return false;
    }
    const fullMatch = text.substring(tree.from!, tree.to!);
    try {
      const promise = renderDirectives(pageMeta, tree);
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

  return replacements;
}

export async function updateDirectivesInSpace() {
  const pages = await space.listPages();
  await mq.batchSend(directiveUpdateQueueName, pages.map((page) => page.name));

  // Now let's wait for the processing to finish
  let queueStats = await mq.getQueueStats(directiveUpdateQueueName);
  while (queueStats.queued > 0 || queueStats.processing > 0) {
    sleep(1000);
    queueStats = await mq.getQueueStats(directiveUpdateQueueName);
  }

  console.log("Done updating directives in space!");
}

async function updateDirectivesForPage(
  pageName: string,
) {
  const pageMeta = await space.getPageMeta(pageName);
  const currentText = await space.readPage(pageName);
  const tree = await markdown.parseMarkdown(currentText);
  const metaData = await extractFrontmatter(tree, ["$disableDirectives"]);

  if (isFederationPath(pageName)) {
    console.info("Current page is a federation page, not updating directives.");
    return;
  }

  if (metaData.$disableDirectives) {
    console.info("Directives disabled in page meta, not updating them.");
    return;
  }

  const newText = await updateDirectives(pageMeta, tree, currentText);
  if (newText !== currentText) {
    console.info("Content of page changed, saving", pageName);
    await space.writePage(pageName, newText);
  }
}

export async function updateDirectives(
  pageMeta: PageMeta,
  tree: ParseTree,
  text: string,
) {
  const replacements = await findReplacements(tree, text, pageMeta);

  // Iterate again and replace the bodies.
  for (const replacement of replacements) {
    text = text.replace(
      replacement.fullMatch,
      await replacement.textPromise,
    );
  }
  return text;
}
