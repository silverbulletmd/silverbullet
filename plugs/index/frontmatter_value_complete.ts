import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";
import { frontmatterTagComplete } from "./tags.ts";
import {
  frontmatterAuthorComplete,
  frontmatterRecipientComplete,
} from "./identity.ts";

/** One `editor:complete` handler for every frontmatter *value* completer.
 * Each helper returns null unless the cursor is in its key's value, so
 * trying them in turn routes to the right one — a single plug dispatch per
 * keystroke instead of one per key. Add a new key by adding a line here. */
export async function frontmatterValueComplete(completeEvent: CompleteEvent) {
  return (
    (await frontmatterTagComplete(completeEvent)) ??
    (await frontmatterRecipientComplete(completeEvent)) ??
    (await frontmatterAuthorComplete(completeEvent))
  );
}
