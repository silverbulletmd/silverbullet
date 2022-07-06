import { PageMeta } from "@silverbulletmd/common/types";
import {
  deleteFile,
  getFileMeta,
  listFiles,
  readFile,
  writeFile,
} from "@plugos/plugos-syscall/fs";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import {
  findNodeOfType,
  renderToText,
  replaceNodesMatching,
} from "@silverbulletmd/common/tree";
import { readPage } from "@silverbulletmd/plugos-silverbullet-syscall/space";
import YAML from "yaml";

const globalMountPrefix = "🚪 ";

type MountPoint = {
  prefix: string;
  path: string;
  perm: "rw" | "ro";
};

let mountPointCache: MountPoint[] = [];

async function updateMountPoints() {
  let mountPointsText = "";
  try {
    let { text } = await readPage("MOUNTS");
    mountPointsText = text;
  } catch {
    // No MOUNTS file, so that's all folks!
    mountPointCache = [];
    return;
  }

  let tree = await parseMarkdown(mountPointsText);

  let codeTextNode = findNodeOfType(tree, "CodeText");
  if (!codeTextNode) {
    console.error("Could not find yaml block in MOUNTS");
    return;
  }
  let mountsYaml = codeTextNode.children![0].text;
  let mountList = YAML.parse(mountsYaml!);
  if (!Array.isArray(mountList)) {
    console.error("Invalid MOUNTS file, should have array of mount points");
    return;
  }
  for (let mountPoint of mountList) {
    if (!mountPoint.prefix) {
      console.error("Invalid mount point, no prefix specified", mountPoint);
      return;
    }
    if (!mountPoint.path) {
      console.error("Invalid mount point, no path specified", mountPoint);
      return;
    }
    if (!mountPoint.perm) {
      mountPoint.perm = "rw";
    }
  }

  mountPointCache = mountList;
}

async function translateLinksWithPrefix(
  text: string,
  prefix: string
): Promise<string> {
  prefix = `${globalMountPrefix}${prefix}`;
  let tree = await parseMarkdown(text);
  replaceNodesMatching(tree, (tree) => {
    if (tree.type === "WikiLinkPage") {
      // Add the prefix in the link text
      tree.children![0].text = prefix + tree.children![0].text;
    }
    return undefined;
  });
  text = renderToText(tree);
  return text;
}

async function translateLinksWithoutPrefix(text: string, prefix: string) {
  prefix = `${globalMountPrefix}${prefix}`;
  let tree = await parseMarkdown(text);
  replaceNodesMatching(tree, (tree) => {
    if (tree.type === "WikiLinkPage") {
      // Remove the prefix in the link text
      let text = tree.children![0].text!;
      if (text.startsWith(prefix)) {
        tree.children![0].text = text.substring(prefix.length);
      }
    }
    return undefined;
  });
  return renderToText(tree);
}

function lookupMountPoint(fullPath: string): {
  resolvedPath: string;
  mountPoint: MountPoint;
} {
  fullPath = fullPath.substring(globalMountPrefix.length);
  for (let mp of mountPointCache) {
    if (fullPath.startsWith(mp.prefix)) {
      return {
        resolvedPath: `${mp.path}/${fullPath.substring(mp.prefix.length)}`,
        mountPoint: mp,
      };
    }
  }
  throw new Error("No mount point found for " + fullPath);
}

export async function readPageMounted(
  name: string
): Promise<{ text: string; meta: PageMeta }> {
  await updateMountPoints();
  let { resolvedPath, mountPoint } = lookupMountPoint(name);
  let { text, meta } = await readFile(`${resolvedPath}.md`);
  return {
    text: await translateLinksWithPrefix(text, mountPoint.prefix),
    meta: {
      name: name,
      lastModified: meta.lastModified,
      perm: mountPoint.perm,
    },
  };
}

export async function writePageMounted(
  name: string,
  text: string
): Promise<PageMeta> {
  await updateMountPoints();
  let { resolvedPath, mountPoint } = lookupMountPoint(name);
  text = await translateLinksWithoutPrefix(text, mountPoint.prefix);
  let meta = await writeFile(`${resolvedPath}.md`, text);
  return {
    name: name,
    lastModified: meta.lastModified,
    perm: mountPoint.perm,
  };
}

export async function deletePageMounted(name: string): Promise<void> {
  await updateMountPoints();
  let { resolvedPath, mountPoint } = lookupMountPoint(name);
  if (mountPoint.perm === "rw") {
    await deleteFile(`${resolvedPath}.md`);
  } else {
    throw new Error("Deleting read-only page");
  }
}

export async function getPageMetaMounted(name: string): Promise<PageMeta> {
  await updateMountPoints();
  let { resolvedPath, mountPoint } = lookupMountPoint(name);
  let meta = await getFileMeta(`${resolvedPath}.md`);
  return {
    name,
    lastModified: meta.lastModified,
    perm: mountPoint.perm,
  };
}

export async function listPagesMounted(): Promise<PageMeta[]> {
  await updateMountPoints();
  let allPages: PageMeta[] = [];
  for (let mp of mountPointCache) {
    let files = await listFiles(mp.path, true);
    for (let file of files) {
      if (!file.name.endsWith(".md")) {
        continue;
      }
      allPages.push({
        name: `${globalMountPrefix}${mp.prefix}${file.name.substring(
          0,
          file.name.length - 3
        )}`,
        lastModified: file.lastModified,
        perm: mp.perm,
      });
    }
  }
  return allPages;
}
