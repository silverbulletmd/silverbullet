import type { Completion } from "@codemirror/autocomplete";
import { config, index, lua } from "@silverbulletmd/silverbullet/syscalls";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";

export async function attributeCompletion(
  tags: string[],
): Promise<Completion[]> {
  const completions: Completion[] = [];

  for (const tag of tags) {
    const schema = await config.get<any>(["tags", tag, "schema"], null);
    if (!schema) {
      continue;
    }
    for (const [attr, val] of Object.entries(schema.properties)) {
      const def = val as any;

      if (def.readOnly) {
        continue;
      }

      completions.push({
        label: attr,
        type: `attribute`,
        detail: `for #${tag} (type: ${humanReadableSchemaType(def)})${
          def.description ? `: ${def.description}` : ""
        }`,
        apply: `${attr}: `,
      });
    }
  }

  return completions;
}

const VALUE_STOP_CHARS = `\\s!@$%^&*(),.?":{}|<>\\\\[\\]`;

/**
 * The prefix typed so far inside a frontmatter key's value, or null when the
 * cursor isn't there. Covers both shapes a list is written in: inline after
 * the key (`key: a, b`, `key: [a, b`) and one `- item` per line under it.
 *
 * `sigil` is a character a value may be written with but that YAML would
 * choke on unquoted (`@` on a recipient). It counts as part of the prefix, so
 * completing replaces it rather than appending after it.
 */
export function frontmatterValuePrefix(
  completeEvent: CompleteEvent,
  key: string,
  sigil?: string,
): string | null {
  const frontmatterNode = completeEvent.parentNodes.find((n) =>
    n.startsWith("FrontMatter:"),
  );
  if (!frontmatterNode) {
    return null;
  }

  const stop = sigil ? VALUE_STOP_CHARS.replace(sigil, "") : VALUE_STOP_CHARS;
  const inlineMatch = new RegExp(
    `${key}:\\s+\\[?(?:.*[,\\s]\\s*)?([^${stop}]*)$`,
  ).exec(completeEvent.linePrefix);
  if (inlineMatch) {
    return inlineMatch[1];
  }

  // A block sequence under a key is as often written flush-left as indented.
  const listItemMatch = new RegExp(`^\\s*-\\s+([^${stop}]*)$`).exec(
    completeEvent.linePrefix,
  );
  if (!listItemMatch) {
    return null;
  }

  // Which key's list is this? The nearest `key:` line above the cursor.
  const cursorLineText = completeEvent.linePrefix.trimEnd();
  let inSection = false;
  for (const line of frontmatterNode
    .substring("FrontMatter:".length)
    .split("\n")) {
    const kvMatch = /^\s*(\w+):/.exec(line);
    if (kvMatch) {
      inSection = kvMatch[1] === key;
    }
    if (inSection && line.trimEnd() === cursorLineText) {
      return listItemMatch[1];
    }
  }
  return null;
}

function humanReadableSchemaType(type: any): string {
  if (!type) {
    return "any";
  }
  if (type.type) {
    return type.type;
  }
  if (type.anyOf) {
    return type.anyOf.map(humanReadableSchemaType).join(" | ");
  }
  return "any";
}

type AnchorObject = ObjectValue<{
  ref: string;
  page: string;
  hostTag: string;
}>;

/**
 * Autocomplete anchor names inside wikilinks.
 * Triggers when the user types `[[$` (bare anchor) or `[[Page Name$` (page-qualified anchor).
 */
export async function anchorComplete(completeEvent: CompleteEvent) {
  // Match `[[` (or `[alias](`) followed by an optional page name, then `$` and optional prefix.
  // Group `page`: everything before the `$` (may be empty for bare anchors).
  // Group `prefix`: the partial anchor name typed so far (may be empty).
  // This negative lookbehind is to prevent matching query[[. This requires negative lookbehind,
  // which is generally supported now (it seems), in versions of iOS Safari 13.1 and later
  // https://caniuse.com/js-regexp-lookbehind
  const anchorMatch =
    /(?<!query)\[\[(?<page>[^\]$]*)\$(?<prefix>[A-Za-z0-9_/:-]*)$/.exec(
      completeEvent.linePrefix,
    );
  if (!anchorMatch) {
    return null;
  }
  const { page, prefix } = anchorMatch.groups!;

  // The completion start position is right after `[[`, so the label (which already
  // includes `<page>$<ref>`) replaces `<page>$<typed-prefix>` entirely.
  const from = completeEvent.pos - prefix.length - 1 /* $ */ - page.length;

  let anchors: AnchorObject[];
  if (page) {
    anchors = await index.queryLuaObjects<AnchorObject>(
      "anchor",
      {
        objectVariable: "_",
        where: await lua.parseExpression(`_.page == p`),
      },
      { p: page },
    );
  } else {
    anchors = await index.queryLuaObjects<AnchorObject>("anchor", {}, {});
  }

  const filtered = anchors
    .filter((a) => a.ref.startsWith(prefix))
    .sort((a, b) => a.ref.localeCompare(b.ref));

  return {
    from,
    options: filtered.map((a) => ({
      label: `${page}$${a.ref}`,
      type: "anchor",
      detail: `${a.hostTag} on ${a.page}`,
    })),
  };
}

/**
 * Task state completion
 */
export async function completeTaskState(completeEvent: CompleteEvent) {
  const taskMatch = /([-*]\s+\[)([^[\]]*)$/.exec(completeEvent.linePrefix);
  if (!taskMatch) {
    return null;
  }
  const allStates = Object.keys(await config.get("taskStates", {}));
  const typed = taskMatch[2];

  let options: string[];
  if (!typed) {
    // Nothing typed — show all
    options = allStates;
  } else if (allStates.includes(typed)) {
    // Exact match (dropdown click on existing state) — show all
    options = allStates;
  } else {
    // Partial typing — filter by prefix, fall back to all if nothing matches
    const filtered = allStates.filter((s) =>
      s.toLowerCase().startsWith(typed.toLowerCase()),
    );
    options = filtered.length > 0 ? filtered : allStates;
  }

  return {
    from: completeEvent.pos - typed.length,
    filter: false,
    options: options.map((state) => ({
      label: state,
    })),
  };
}
