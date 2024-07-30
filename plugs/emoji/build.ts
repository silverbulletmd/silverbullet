// Generates emoji.json from emoji-data.txt
const emojiRe = /#\s([^\s]+)\s+E[^\s]+\s+(.+)$/;

const text = Deno.readTextFileSync("emoji-data.txt");
const lines = text.split("\n").filter((line) => !line.startsWith("#"));

const emojis: string[] = [];
for (const line of lines) {
  const match = emojiRe.exec(line);
  if (match) {
    const emoji = match[1];
    const name = match[2].toLowerCase().replaceAll(/\W+/g, "_");
    emojis.push(`${name} ${emoji}`);
  }
}

Deno.writeFileSync(
  "emoji.json",
  new TextEncoder().encode(JSON.stringify(emojis.join("|"))),
);
