// Generates emoji.json from emoji-data.txt
const { readFileSync, writeFileSync } = require("fs");

const emojiRe = /#\s([^\s]+)\s+E[^\s]+\s+(.+)$/;

let text = readFileSync("emoji-data.txt", "utf-8");
const lines = text.split("\n").filter((line) => !line.startsWith("#"));

let emoji = [];
for (const line of lines) {
  let match = emojiRe.exec(line);
  if (match) {
    emoji.push([match[1], match[2].toLowerCase().replaceAll(/\W+/g, "_")]);
  }
}

writeFileSync("emoji.json", JSON.stringify(emoji));
