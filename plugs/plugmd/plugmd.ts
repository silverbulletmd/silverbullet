import { collectNodesOfType, findNodeOfType } from "../../common/tree.ts";
import { getText, hideBhs, showBhs } from "$sb/silverbullet-syscall/editor.ts";
import { parseMarkdown } from "$sb/silverbullet-syscall/markdown.ts";
import { readPage, writePage } from "$sb/silverbullet-syscall/space.ts";
import {
  invokeFunction,
  reloadPlugs,
} from "$sb/silverbullet-syscall/system.ts";
import * as YAML from "yaml";

import type { Manifest } from "../../common/manifest.ts";

export async function compileCommand() {
  let text = await getText();
  try {
    let manifest = await compileDefinition(text);
    await writePage(
      `_plug/${manifest.name}`,
      JSON.stringify(manifest, null, 2),
    );
    console.log("Wrote this plug", manifest);
    await hideBhs();

    await reloadPlugs();
  } catch (e: any) {
    await showBhs(e.message);
    // console.error("Got this error from compiler", e.message);
  }
}

export async function checkCommand() {
  let text = await getText();
  try {
    await compileDefinition(text);
    await hideBhs();
    reloadPlugs();
  } catch (e: any) {
    await showBhs(e.message);
    // console.error("Got this error from compiler", e.message);
  }
}

async function compileDefinition(text: string): Promise<Manifest> {
  let tree = await parseMarkdown(text);

  let codeNodes = collectNodesOfType(tree, "FencedCode");
  let manifest: Manifest | undefined;
  let code: string | undefined;
  let language = "js";
  for (let codeNode of codeNodes) {
    let codeInfo = findNodeOfType(codeNode, "CodeInfo")!.children![0].text!;
    let codeText = findNodeOfType(codeNode, "CodeText")!.children![0].text!;
    if (codeInfo === "yaml") {
      manifest = YAML.parse(codeText);
      continue;
    }
    if (codeInfo === "typescript" || codeInfo === "ts") {
      language = "ts";
    }
    code = codeText;
  }

  if (!manifest) {
    throw new Error("No meta found");
  }

  if (!code) {
    throw new Error("No code found");
  }

  manifest.dependencies = manifest.dependencies || {};

  for (let [dep, depSpec] of Object.entries(manifest.dependencies)) {
    let compiled = await invokeFunction("server", "compileModule", depSpec);
    manifest.dependencies![dep] = compiled;
  }

  manifest.functions = manifest.functions || {};

  for (let [name, func] of Object.entries(manifest.functions)) {
    let compiled = await invokeFunction(
      "server",
      "compileJS",
      `file.${language}`,
      code,
      name,
      Object.keys(manifest.dependencies),
    );
    func.code = compiled;
  }

  console.log("Doing the whole manifest thing");

  return manifest;
}

export async function compileJS(
  filename: string,
  code: string,
  functionName: string,
  excludeModules: string[],
): Promise<string> {
  // console.log("Compiling JS", filename, excludeModules);
  return self.syscall(
    "esbuild.compile",
    filename,
    code,
    functionName,
    excludeModules,
  );
}

export async function compileModule(moduleName: string): Promise<string> {
  return self.syscall("esbuild.compileModule", moduleName);
}

export async function getPlugPlugMd(pageName: string): Promise<Manifest> {
  let { text } = await readPage(pageName);
  console.log("Compiling", pageName);
  return compileDefinition(text);
}
