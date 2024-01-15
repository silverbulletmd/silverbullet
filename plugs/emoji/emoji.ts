import emojiBlob from "./emoji.json" assert { type: "json" };
import type { CompleteEvent } from "$sb/app_event.ts";

const emojis = emojiBlob.split("|").map((line) => line.split(" "));

export function emojiCompleter({ linePrefix, pos }: CompleteEvent) {
  const match = /:([\w]+)$/.exec(linePrefix);
  if (!match) {
    return null;
  }

  const [fullMatch, emojiName] = match;

  const filteredEmoji = emojis.filter(([shortcode]) =>
    shortcode.includes(emojiName)
  );

  return {
    from: pos - fullMatch.length,
    filter: false,
    options: filteredEmoji.map(([shortcode, emoji]) => ({
      detail: shortcode,
      label: emoji,
      type: "emoji",
    })),
  };
}
