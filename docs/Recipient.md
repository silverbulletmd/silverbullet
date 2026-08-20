---
description: Mention people, teams, or anything else worth addressing with @nickname.
tags: glossary maturity/experimental
references:
- plugs/index/recipient.ts
- plugs/index/relation.ts
- plugs/index/indexer.ts
- plugs/index/lint.ts
- client/codemirror/at_mention.ts
- plugs/editor/navigate.ts
- libraries/Library/Std/Editor/Mention Inbox.md
---
A **recipient** is anything worth addressing directly: a team mate, a team, a project, anything you’d want to point at with @nickname. Typing `@nickname` anywhere creates a mention: a clickable pill, and an indexed relation you can query.

In turn, the ${widgets.commandButton("Navigate: Mentions")} provides a convenient way to find where specific subjects are addressed this way.

# `@nickname` syntax
Type `@` followed by a name with no spaces, e.g. @zef. While typing, autocomplete offers every known recipient: both ad-hoc used as well as any page tagged with `#recipient` (see below).

**Any nickname is a valid mention.** Nothing needs declaring up front: mentioning @sales makes `sales` a recipient. A mention renders as a small pill in the editor, clicking it opens the [[#The Mention Inbox|Mention Inbox]] filtered on that recipient.

# Page-backed recipients
Tag any page `#recipient`, either in its frontmatter or as a body hashtag, to give a recipient a page of its own. Its default nickname is the last segment of the page name with spaces stripped, matched case-insensitively.

Add more nicknames with the page’s `aliases` [[Frontmatter]] attribute:

```yaml
---
tags: recipient
aliases:
- pete
- Pete Smith Jr
---
```

Each alias contributes a nickname by stripping its spaces, e.g. `Pete Smith Jr` becomes `@PeteSmithJr`; a space-free alias like `pete` passes through unchanged. Now `@pete`, `@PeteSmithJr`, `@PeteSmith` and `@petesmith` all resolve to the same page, and count as mentions of the same person: the Mention Inbox lists them as one recipient, whichever spelling each was written with.

The tag itself is configurable: set the `recipients.tag` config option (also editable in the Configuration Manager under **Indexing → Recipient tag**) to use a different tag, e.g. `person`.

# The Mention Inbox
The Mention Inbox is a sidebar view listing open `@mention`s, grouped by page. Open it with `Navigate: Mentions`, or by clicking any mention pill (which opens it pre-filtered on that recipient). Hover a row for its actions:

* **Resolve to link** rewrites the mention into a plain wiki link at the same spot: `@PeteSmith` becomes `[[People/Pete Smith|PeteSmith]]`, now a normal link (and a real backlink) instead of a mention. The link points at whichever page claims the nickname at that moment, and is only offered when some page does.
* **Remove mention** deletes just the `@mention`, tidying the spacing around it.
* **Delete task/item/paragraph** deletes the whole task, item line or paragraph hosting the mention, after a confirmation.

If the page changed since it was last indexed, these actions leave the text untouched and show a notification instead of risking a bad edit.

Recipients declared in `recipients:` frontmatter (see below) are listed too, under their page and marked with an `@` icon. They address the whole page rather than a spot in it, so they carry none of the three actions above — selecting one just opens the page.

# The `recipients` attribute
Every mention also sets a `recipients` attribute onto the object that hosts it. It holds identifiers in either of two forms: a `recipient:` identifier for a nickname, and a plain page name where a page was named directly (see the frontmatter form below).
* a mention inside a task or list item stamps that task or item;
* a mention in a plain paragraph or header stamps the **page** object instead.

Inline `@mentions` always stamp the `recipient:` form, since a mention is a nickname. Pages can also declare recipients declaratively in frontmatter, by nickname or wiki link — useful when a whole page is “for” someone without inline mentions. There a nickname stamps its `recipient:` identifier, exactly like an inline mention would, while a wiki link names a page directly and stamps that page name:

```yaml
---
recipients: ["petesmith", "[[Team/Operations]]"]
---
```

A declared nickname counts as a mention of that recipient everywhere else too: it makes the nickname a known recipient for autocomplete, and it shows up in the Mention Inbox's recipient dropdown.

# Querying mentions
At-mentions are indexed like any other [[Object Index|relation]], with `kind == "at-mention"`. `to` is always the `recipient:` identifier (`toTag == "recipient"`) and `alias` holds the nickname as typed. Build your own view over them with SLIQ, for example:

```lua
${query[[
  from index.relations "at-mention"
  where _.to == "recipient:petesmith"
  select { page = _.page, snippet = _.snippet }
]]}
```

Frontmatter declarations are relations too, with `kind == "recipients"`. A nickname entry targets its `recipient:` identifier and carries no `range` (there is no `@nickname` in the text to point at); a wiki link entry targets the page by name, with a range covering the link.

To go from a mention to the recipient it belongs to — or the other way around — join with `index.listRecipients()`. It returns one entry per recipient: `{ nickname, nicknames, target, page?, ids }`, where `nicknames` are all the spellings that recipient answers to, `ids` the `recipient:` identifiers mentions of them carry, and `page` the `#recipient` page claiming them right now (absent when no page does). `target` is the grouping key: the page name for a page-backed recipient — so all of their spellings group together — and the `recipient:` identifier otherwise.
