import emojis from "./emoji.json" assert { type: "json" };
import { editor } from "$sb/silverbullet-syscall/mod.ts";

export async function emojiCompleter() {
  const prefix = await editor.matchBefore(":[\\w]+");
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
