// Generates emoji.json from emoji-data.txt
import { readFileSync, writeFileSync } from "node:fs";

const emojiRe = /#\s([^\s]+)\s+E[^\s]+\s+(.+)$/;

const text = readFileSync("emoji-data.txt", "utf-8");
const lines = text.split("\n").filter((line: string) => !line.startsWith("#"));

const emojis: string[] = [];
for (const line of lines) {
  const match = emojiRe.exec(line);
  if (match) {
    const emoji = match[1];
    const name = match[2].toLowerCase().replaceAll(/\W+/g, "_");
    emojis.push(`${name} ${emoji}`);
  }
}

writeFileSync("emoji.json", JSON.stringify(emojis.join("|")), "utf-8");
