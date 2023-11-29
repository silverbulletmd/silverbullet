import { editor, events, markdown } from "$sb/syscalls.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { PublishEvent } from "$sb/app_event.ts";

export async function publishCommand() {
  await editor.save();
  const text = await editor.getText();
  const pageName = await editor.getCurrentPage();
  const tree = await markdown.parseMarkdown(text);
  let { $share } = await extractFrontmatter(tree);
  if (!$share) {
    // Nothing to do here
    return;
  }
  if (!Array.isArray($share)) {
    $share = [$share];
  }
  await editor.flashNotification("Sharing...");
  try {
    await publish(pageName, $share);
    await editor.flashNotification("Done!");
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
  }
}

async function publish(pageName: string, uris: string[]) {
  const broadcastResults = await events.dispatchEvent(`share:_`, {
    name: pageName,
  } as PublishEvent);
  for (const uri of uris) {
    const publisher = uri.split(":")[0];
    const results = await events.dispatchEvent(
      `share:${publisher}`,
      {
        uri: uri,
        name: pageName,
      } as PublishEvent,
    );
    if (broadcastResults.length === 0 && results.length === 0) {
      throw new Error(`Unsupported publisher: ${publisher} for URI: ${uri}`);
    }
  }
}
