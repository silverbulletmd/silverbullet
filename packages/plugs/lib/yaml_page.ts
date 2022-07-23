import { findNodeOfType, ParseTree, renderToText, replaceNodesMatching, traverseTree } from "@silverbulletmd/common/tree";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { readPage, writePage } from "@silverbulletmd/plugos-silverbullet-syscall/space";
import YAML from "yaml";

export async function readYamlPage(
  pageName: string,
  allowedLanguages = ["yaml"]
): Promise<any> {
  const { text } = await readPage(pageName);
  let tree = await parseMarkdown(text);
  let data: any = {};

  traverseTree(tree, (t): boolean => {
    // Find a fenced code block
    if (t.type !== "FencedCode") {
      return false;
    }
    let codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return false;
    }
    if (!allowedLanguages.includes(codeInfoNode.children![0].text!)) {
      return false;
    }
    let codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return false;
    }
    let codeText = codeTextNode.children![0].text!;
    try {
      data = YAML.parse(codeText);
    } catch (e: any) {
      console.error("YAML Page parser error", e);
      throw new Error(`YAML Error: ${e.message}`);
    }
    return true;
  });

  return data;
}

export async function writeYamlPage(
  pageName: string,
  properties: any,
  templateOnEmpty: string,
): Promise<Boolean> {
  let text;
  try {
    const page = await readPage(pageName);
    text = page.text;
  } catch {
    // page doesn't exist, so let's create one.
    text = templateOnEmpty;
  }
  const tree = await parseMarkdown(text);
  // if we use any other language than yaml... how to create it?
  const doc = new YAML.Document();
  doc.contents = properties;
  // generate a new node for the properties
  const newCode = `\`\`\`yaml\n${doc.toString()}\n\`\`\``;
  const subtree = await parseMarkdown(newCode);
  // find the original set of properties and replace
  let replaced = false;
  replaceNodesMatching(tree, (node: ParseTree) => {
    if (node.type !== 'FencedCode') {
      return;
    }
    const codeinfoNode = findNodeOfType(node, "CodeInfo");
    if (!codeinfoNode || codeinfoNode.children![0].text! !== "yaml") {
      return;
    }
    replaced = true;
    return subtree;
  });
  if (replaced) {
    await writePage(pageName, renderToText(tree));
  }
  return replaced;
}