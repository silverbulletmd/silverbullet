import type { Manifest } from "@silverbulletmd/common/manifest";
import {
  addParentPointers,
  collectNodesOfType,
  findNodeOfType,
} from "@silverbulletmd/common/tree";
import {
  getCurrentPage,
  getText,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { writePage } from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { invokeFunction } from "@silverbulletmd/plugos-silverbullet-syscall/system";
import YAML from "yaml";
import { extractMeta } from "../query/data";

export async function compileCommand() {
  let text = await getText();
  let tree = await parseMarkdown(text);
  addParentPointers(tree);
  let allHeaders = collectNodesOfType(tree, "ATXHeading2");
  let manifest: Manifest = {
    functions: {},
  };
  for (let t of allHeaders) {
    let parent = t.parent!;
    let headerIdx = parent.children!.indexOf(t);
    let headerTitle = t.children![1].text!.trim();
    if (!headerTitle.startsWith("function ")) {
      continue;
    }
    let functionName = headerTitle
      .substring("function ".length)
      .replace(/[^\w]/g, "_");
    let meta: any;
    let code: string | undefined;
    let language = "js";
    for (let i = headerIdx + 1; i < parent.children!.length; i++) {
      let child = parent.children![i];
      if (child.type === "FencedCode") {
        let codeInfo = findNodeOfType(child, "CodeInfo")!.children![0].text!;
        let codeText = findNodeOfType(child, "CodeText")!.children![0].text!;
        if (codeInfo === "yaml") {
          meta = YAML.parse(codeText);
          continue;
        }
        if (codeInfo === "typescript" || codeInfo === "ts") {
          language = "ts";
        }
        code = codeText;
      }

      if (child.type?.startsWith("ATXHeading")) {
        break;
      }
    }
    if (code) {
      let compiled = await invokeFunction(
        "server",
        "compileJS",
        `file.${language}`,
        code
      );
      manifest.functions[functionName] = meta;
      manifest.functions[functionName].code = compiled;
    }
  }

  let pageMeta = extractMeta(tree);

  if (pageMeta.name) {
    await writePage(
      `_plug/${pageMeta.name}`,
      JSON.stringify(manifest, null, 2)
    );
    console.log("Wrote this plug", manifest);
  }
}

export async function compileJS(
  filename: string,
  code: string
): Promise<string> {
  return self.syscall("esbuild.compile", filename, code);
}
