import {
  findNodeOfType,
  removeParentPointers,
  renderToText,
} from "$sb/lib/tree.ts";
import { getText } from "$sb/silverbullet-syscall/editor.ts";
import { parseMarkdown } from "$sb/silverbullet-syscall/markdown.ts";
import {
  extractFrontmatter,
  prepareFrontmatterDispatch,
} from "$sb/lib/frontmatter.ts";
import { store, YAML } from "$sb/plugos-syscall/mod.ts";
import { collab, editor, markdown } from "$sb/silverbullet-syscall/mod.ts";

import { nanoid } from "https://esm.sh/nanoid@4.0.0";
import { FileMeta } from "../../common/types.ts";
import { base64EncodedDataUrl } from "../../plugos/asset_bundle/base64.ts";

const defaultServer = "wss://collab.silverbullet.md";

async function ensureUsername(): Promise<string> {
  let username = await store.get("collabUsername");
  if (!username) {
    username = await editor.prompt(
      "Please enter a publicly visible user name (or cancel for 'anonymous'):",
    );
    if (!username) {
      return "anonymous";
    } else {
      await store.set("collabUsername", username);
    }
  }
  return username;
}

export async function joinCommand() {
  let collabUri = await editor.prompt(
    "Collab share URI:",
  );
  if (!collabUri) {
    return;
  }
  if (!collabUri.startsWith("collab:")) {
    collabUri = "collab:" + collabUri;
  }
  await editor.navigate(collabUri);
}

export async function shareCommand() {
  const serverUrl = await editor.prompt(
    "Please enter the URL of the collab server to use:",
    defaultServer,
  );
  if (!serverUrl) {
    return;
  }
  const roomId = nanoid().replaceAll("_", "-");
  await editor.save();
  const text = await editor.getText();
  const tree = await markdown.parseMarkdown(text);
  let { $share } = await extractFrontmatter(tree);
  if (!$share) {
    $share = [];
  }
  if (!Array.isArray($share)) {
    $share = [$share];
  }

  removeParentPointers(tree);
  const dispatchData = await prepareFrontmatterDispatch(tree, {
    $share: [...$share, `collab:${serverUrl}/${roomId}`],
  });

  await editor.dispatch(dispatchData);

  collab.start(
    serverUrl,
    roomId,
    await ensureUsername(),
  );
}

export async function detectPage() {
  const tree = await parseMarkdown(await getText());
  const frontMatter = findNodeOfType(tree, "FrontMatter");
  if (frontMatter) {
    const yamlText = renderToText(frontMatter.children![1].children![0]);
    try {
      let { $share } = await YAML.parse(yamlText) as any;
      if (!$share) {
        return;
      }
      if (!Array.isArray($share)) {
        $share = [$share];
      }
      for (const uri of $share) {
        if (uri.startsWith("collab:")) {
          console.log("Going to enable collab");
          const uriPieces = uri.substring("collab:".length).split("/");
          await collab.start(
            // All parts except the last one
            uriPieces.slice(0, uriPieces.length - 1).join("/"),
            // because the last one is the room ID
            uriPieces[uriPieces.length - 1],
            await ensureUsername(),
          );
        }
      }
    } catch (e) {
      console.error("Error parsing YAML", e);
    }
  }
}

export function shareNoop() {
  return true;
}

export function readFileCollab(
  name: string,
): { data: string; meta: FileMeta } {
  if (!name.endsWith(".md")) {
    throw new Error("Not found");
  }
  const collabUri = name.substring(0, name.length - ".md".length);
  const text = `---\n$share: ${collabUri}\n---\n`;

  return {
    // encoding === "arraybuffer" is not an option, so either it's "utf8" or "dataurl"
    data: base64EncodedDataUrl(
      "text/markdown",
      new TextEncoder().encode(text),
    ),
    meta: {
      name,
      contentType: "text/markdown",
      size: text.length,
      lastModified: 0,
      perm: "rw",
    },
  };
}

export function getFileMetaCollab(name: string): FileMeta {
  return {
    name,
    contentType: "text/markdown",
    size: -1,
    lastModified: 0,
    perm: "rw",
  };
}

export function writeFileCollab(name: string): FileMeta {
  return {
    name,
    contentType: "text/markdown",
    size: -1,
    lastModified: 0,
    perm: "rw",
  };
}
