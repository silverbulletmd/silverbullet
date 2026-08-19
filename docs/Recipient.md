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
A **recipient** is anything worth addressing directly: a team mate, a team, a project, anything you’d want to point at with `@nickname`. Typing `@nickname` anywhere creates a mention: a clickable pill, and an indexed relation you can query.

# `@nickname` syntax
Type `@` followed by a name with no spaces, e.g. `@PeteSmith`. While typing, autocomplete offers every known nickname: page-backed recipients with their target page as detail, plus every nickname already mentioned somewhere in the space.

**Any nickname is a valid mention.** Nothing needs declaring up front: mentioning `@sales` makes `sales` a recipient. A mention renders as a small pill in the editor; clicking it opens the [[#The Mention Inbox|Mention Inbox]] filtered on that recipient.

# Page-backed recipients
Tag any page `#recipient`, either in its frontmatter or as a body hashtag, to give a recipient a page of its own. Its default nickname is the last segment of the page name with spaces stripped, matched case-insensitively:

```
People/Pete Smith  ->  @PeteSmith or @petesmith
```

Add more nicknames with the page's `aliases` [[Frontmatter]] attribute — the same one the page picker uses for alternative names, so on a recipient-tagged page an alias does double duty: it's both an alternative way to find and link to the page, and a mention handle — link, navigate, and `@mention` are all facets of the same alias.

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

## Mentions record nicknames, pages are joined at read time
A mention never records *who* a nickname belongs to, only the nickname itself, as the namespaced identifier `recipient:<nickname>` (lowercased, so `@Bob` and `@bob` converge). Which page — if any — currently claims that nickname is looked up when mentions are read: by the Mention Inbox, by the autocompleter, and when you click a pill. That lookup is also what collapses a person's several spellings into one recipient.

So tagging a page `#recipient` (or adding a nickname to a page's `aliases`) takes effect immediately, for every mention of that nickname anywhere in the space; untagging it takes effect just as immediately, leaving the mentions themselves intact. Nothing needs reindexing, and mentions of the same nickname can never disagree about who it refers to.

The flip side: an `@mention` is *not* a link, so it does not show up under [[Linked Mention|Linked Mentions]] on the recipient's page. Use **Resolve to link** (below) when you want a durable edge to the page.

## Collisions
Nicknames are collected into one registry, case-insensitively. When two pages would produce the same nickname:

* an **explicit** nickname (derived from a page's `aliases` attribute) always beats a **derived** one (the page-name-based default)
* within the same tier, the recipient whose target page name sorts first alphabetically wins
* whenever more than one candidate is in play, the nickname is flagged “Ambiguous recipient” by the linter on every page that mentions it, naming which target currently wins.

# The Mention Inbox
The Mention Inbox is a sidebar view listing open `@mention`s, grouped by page. Open it with `Navigate: Mentions`, or by clicking any mention pill (which opens it pre-filtered on that recipient). Hover a row for its actions:

* **Resolve to link** rewrites the mention into a plain wiki link at the same spot: `@PeteSmith` becomes `[[People/Pete Smith|PeteSmith]]` — same visible text, now a normal link (and a real backlink) instead of a mention. The link points at whichever page claims the nickname at that moment, and is only offered when some page does.
* **Remove mention** deletes just the `@mention`, tidying the spacing around it.
* **Delete task/item/paragraph** deletes the whole task, item line or paragraph hosting the mention, after a confirmation.

If the page changed since it was last indexed, these actions leave the text untouched and show a notification instead of risking a bad edit.

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

# Querying mentions
At-mentions are indexed like any other [[Object Index|relation]], with `kind == "at-mention"`. `to` is always the `recipient:` identifier (`toTag == "recipient"`) and `alias` holds the nickname as typed. Build your own view over them with SLIQ, for example:

```lua
${query[[
  from index.relations "at-mention"
  where _.to == "recipient:petesmith"
  select { page = _.page, snippet = _.snippet }
]]}
```

To go from a mention to the recipient it belongs to — or the other way around — join with `index.listRecipients()`. It returns one entry per recipient: `{ nickname, nicknames, target, page?, ids }`, where `nicknames` are all the spellings that recipient answers to, `ids` the `recipient:` identifiers mentions of them carry, and `page` the `#recipient` page claiming them right now (absent when no page does). `target` is the grouping key: the page name for a page-backed recipient — so all of their spellings group together — and the `recipient:` identifier otherwise.
