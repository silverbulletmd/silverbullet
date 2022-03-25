import { syscall } from "../lib/syscall";

function countWords(str: string): number {
  var matches = str.match(/[\w\d\'\'-]+/gi);
  return matches ? matches.length : 0;
}

function readingTime(wordCount: number): number {
  // 225 is average word reading speed for adults
  return Math.ceil(wordCount / 225);
}

export async function wordCount({ text }: { text: string }) {
  let sysCallText = (await syscall("editor.getText")) as string;
  const count = countWords(sysCallText);
  console.log("Word count", count);
  let syntaxNode = await syscall("editor.getSyntaxNodeUnderCursor");
  console.log("Syntax node", syntaxNode);
  return count;
}
