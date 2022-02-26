import { syscall } from "./lib/syscall.ts";

export async function linkNavigate() {
  let syntaxNode = await syscall("editor.getSyntaxNodeUnderCursor");
  if (syntaxNode && syntaxNode.name === "WikiLinkPage") {
    await syscall("editor.navigate", syntaxNode.text);
  }
}
