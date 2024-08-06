import { editor, space } from "@silverbulletmd/silverbullet/syscalls";

function countWords(str: string): number {
  const matches = str.match(/[\w\d\'-]+/gi);
  return matches ? matches.length : 0;
}

function readingTime(wordCount: number): number {
  // 225 is average word reading speed for adults
  return Math.ceil(wordCount / 225);
}

export async function statsCommand() {
  const text = await editor.getText();
  const allPages = await space.listPages();
  const wordCount = countWords(text);
  const time = readingTime(wordCount);
  await editor.flashNotification(
    `${text.length} characters; ${wordCount} words; ${time} minutes read; ${allPages.length} total pages in space.`,
  );
}
