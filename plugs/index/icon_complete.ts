import { icon } from "@silverbulletmd/silverbullet/syscalls";
import type { CompletionResult } from "@codemirror/autocomplete";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";

/** Lucide names for an `icon:` value anywhere in the frontmatter, e.g. `pageDecoration.icon`. */
export async function frontmatterIconComplete(
  completeEvent: CompleteEvent,
): Promise<CompletionResult | null> {
  if (!completeEvent.parentNodes.some((n) => n.startsWith("FrontMatter:"))) {
    return null;
  }
  const match = /^\s*icon:\s*([a-z0-9-]*)$/i.exec(completeEvent.linePrefix);
  if (!match) return null;
  const typed = match[1].toLowerCase();
  const names = await icon.names();
  return {
    from: completeEvent.pos - match[1].length,
    filter: false,
    options: names
      .filter((name) => name.includes(typed))
      .sort(
        (a, b) =>
          Number(!a.startsWith(typed)) - Number(!b.startsWith(typed)) ||
          a.localeCompare(b),
      )
      .slice(0, 100)
      .map((name) => ({ label: name, type: "icon", icon: name })),
  };
}
