import { events } from "$sb/plugos-syscall/mod.ts";
import { editor, markdown, system } from "$sb/silverbullet-syscall/mod.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";

export type PublishEvent = {
  uri: string;
  // Page name
  name: string;
};

export async function publishCommand() {
  await editor.save();
  const text = await editor.getText();
  const pageName = await editor.getCurrentPage();
  const tree = await markdown.parseMarkdown(text);
  let { $share } = extractFrontmatter(tree);
  if (!$share) {
    await editor.flashNotification("No $share directive found", "error");
    return;
  }
  if (!Array.isArray($share)) {
    $share = [$share];
  }
  // Delegate actual publishing to the server
  try {
    await system.invokeFunction("server", "publish", pageName, $share);
    await editor.flashNotification("Done!");
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
  }
}

// Runs on server side
export async function publish(pageName: string, uris: string[]) {
  for (const uri of uris) {
    const publisher = uri.split(":")[0];
    const results = await events.dispatchEvent(
      `share:${publisher}`,
      {
        uri: uri,
        name: pageName,
      } as PublishEvent,
    );
    if (results.length === 0) {
      throw new Error(`Unsupported publisher: ${publisher} for URI: ${uri}`);
    }
  }
}
