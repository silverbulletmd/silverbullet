import emojis from "./emoji.json" assert { type: "json" };
import { matchBefore } from "../../syscall/silverbullet-syscall/editor.ts";

export async function emojiCompleter() {
  let prefix = await matchBefore(":[\\w]+");
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
