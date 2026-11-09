import { isToolPage } from "@silverbulletmd/silverbullet/lib/tool_pages";
import type { SpacePrimitives } from "../spaces/space_primitives.ts";
import type { ToolingFile } from "../tooling.ts";

/**
 * Local counterpart of the server's `/.tooling` endpoint: the text of every
 * tool page in the synced space, sorted by path.
 */
export async function buildToolingPayload(
  space: SpacePrimitives,
): Promise<ToolingFile[]> {
  const decoder = new TextDecoder();
  const files: ToolingFile[] = [];
  for (const meta of await space.fetchFileList()) {
    if (!meta.name.endsWith(".md") || !isToolPage(meta.name.slice(0, -3))) {
      continue;
    }
    const { data } = await space.readFile(meta.name);
    files.push({
      path: meta.name,
      lastModified: meta.lastModified,
      text: decoder.decode(data),
    });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
