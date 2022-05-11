import { dispatch } from "@plugos/plugos-syscall/event";
import {
  addParentPointers,
  collectNodesOfType,
  findNodeOfType,
} from "@silverbulletmd/common/tree";
import {
  getText,
  hideBhs,
  showBhs,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import {
  deletePage,
  listPages,
  readPage,
  writePage,
} from "@silverbulletmd/plugos-silverbullet-syscall/space";
import {
  invokeFunction,
  reloadPlugs,
} from "@silverbulletmd/plugos-silverbullet-syscall/system";
import YAML from "yaml";

import { extractMeta } from "../query/data";

import type { Manifest } from "@silverbulletmd/common/manifest";

export async function compileCommand() {
  let text = await getText();
  try {
    let manifest = await compileDefinition(text);
    await writePage(
      `_plug/${manifest.name}`,
      JSON.stringify(manifest, null, 2)
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

  manifest.functions = manifest.functions || {};

  for (let [name, func] of Object.entries(manifest.functions)) {
    let compiled = await invokeFunction(
      "server",
      "compileJS",
      `file.${language}`,
      code,
      name
    );
    func.code = compiled;
  }

  console.log("Doing the whole manifest thing");

  return manifest;
}

export async function compileJS(
  filename: string,
  code: string,
  functionName: string
): Promise<string> {
  return self.syscall("esbuild.compile", filename, code, functionName);
}

async function listPlugs(): Promise<string[]> {
  let unfilteredPages = await listPages(true);
  return unfilteredPages
    .filter((p) => p.name.startsWith("_plug/"))
    .map((p) => p.name.substring("_plug/".length));
}

export async function listCommand() {
  console.log(await listPlugs());
}

export async function updatePlugsCommand() {
  await invokeFunction("server", "updatePlugs");
  await reloadPlugs();
}

export async function updatePlugs() {
  let { text: plugPageText } = await readPage("PLUGS");

  let tree = await parseMarkdown(plugPageText);

  let codeTextNode = findNodeOfType(tree, "CodeText");
  if (!codeTextNode) {
    console.error("Could not find yaml block in PLUGS");
    return;
  }
  let plugYaml = codeTextNode.children![0].text;
  let plugList = YAML.parse(plugYaml!);
  console.log("Plug YAML", plugList);
  let allPlugNames: string[] = [];
  for (let plugUri of plugList) {
    let [protocol, ...rest] = plugUri.split(":");
    let manifests = await dispatch(`get-plug:${protocol}`, rest.join(":"));
    if (manifests.length === 0) {
      console.error("Could not resolve plug", plugUri);
    }
    // console.log("Got manifests", plugUri, protocol, manifests);
    let manifest = manifests[0];
    allPlugNames.push(manifest.name);
    // console.log("Writing", `_plug/${manifest.name}`);
    await writePage(
      `_plug/${manifest.name}`,
      JSON.stringify(manifest, null, 2)
    );
  }

  // And delete extra ones
  for (let existingPlug of await listPlugs()) {
    if (!allPlugNames.includes(existingPlug)) {
      console.log("Removing plug", existingPlug);
      await deletePage(`_plug/${existingPlug}`);
    }
  }
  await reloadPlugs();
}

export async function getPlugPlugMd(pageName: string): Promise<Manifest> {
  let { text } = await readPage(pageName);
  console.log("Compiling", pageName);
  return compileDefinition(text);
}
