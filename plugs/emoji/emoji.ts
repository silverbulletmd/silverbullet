// @ts-ignore
import emojis from "./emoji.json";
import { syscall } from "../lib/syscall";

const emojiMatcher = /\(([^\)]+)\)\s+(.+)$/;

export async function emojiCompleter() {
  let prefix = await syscall("editor.matchBefore", ":[\\w\\s]*");
  if (!prefix) {
    return null;
  }
  const textPrefix = prefix.text.substring(1); // Cut off the initial :
  let filteredEmoji = emojis.filter(([_, shortcode]) =>
    shortcode.includes(textPrefix)
  );

  return {
    from: prefix.from,
    filter: false,
    options: filteredEmoji.map(([emoji, shortcode]) => ({
      detail: shortcode,
      label: emoji,
      type: "emoji",
    })),
  };
}
