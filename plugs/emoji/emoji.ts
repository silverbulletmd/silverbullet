import emojis from "./emoji.json" assert { type: "json" };
import { matchBefore } from "$sb/silverbullet-syscall/editor.ts";

export async function emojiCompleter() {
  const prefix = await matchBefore(":[\\w]+");
  if (!prefix) {
    return null;
  }
  const textPrefix = prefix.text.substring(1); // Cut off the initial :
  const filteredEmoji = emojis.filter(([_, shortcode]) =>
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
