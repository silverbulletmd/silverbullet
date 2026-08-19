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

Each alias contributes a nickname by stripping its spaces, e.g. `Pete Smith Jr` becomes `@PeteSmithJr`; a space-free alias like `pete` passes through unchanged. Now `@pete`, `@PeteSmithJr`, `@PeteSmith` and `@petesmith` all resolve to the same page.

The tag itself is configurable: set the `recipients.tag` config option (also editable in the Configuration Manager under **Indexing → Recipient tag**) to use a different tag, e.g. `person`. Nickname resolution happens at indexing time, so after changing it run ${widgets.commandButton("Space: Reindex")} to re-resolve existing mentions.

## Implicit recipients
A mentioned nickname without a registered page is an **implicit recipient**: the mention is indexed with the namespaced identifier `recipient:<nickname>` (lowercased, so `@Bob` and `@bob` converge) as its target. Implicit recipients show up in the Mention Inbox and its recipient dropdown like any other.

Registering a page is an *upgrade*: tag a page `#recipient` (or add the nickname to a page's `aliases`) and mentions of that nickname re-target the page the next time the mentioning pages are reindexed.

## Collisions
Nicknames are collected into one registry, case-insensitively. When two pages would produce the same nickname:

* an **explicit** nickname (derived from a page's `aliases` attribute) always beats a **derived** one (the page-name-based default)
* within the same tier, the recipient whose target page name sorts first alphabetically wins
* whenever more than one candidate is in play, the nickname is flagged “Ambiguous recipient” by the linter on every page that mentions it, naming which target currently wins.

# The Mention Inbox
The Mention Inbox is a sidebar view listing open `@mention`s, grouped by page. Open it with `Navigate: Mentions`, or by clicking any mention pill (which opens it pre-filtered on that recipient). Hover a row for its actions:

* **Resolve to link** rewrites the mention into a plain wiki link at the same spot: `@PeteSmith` becomes `[[People/Pete Smith|PeteSmith]]` — same visible text, now a normal link instead of a mention. Only offered for page-backed mentions: an implicit recipient has no page to link to.
* **Remove mention** deletes just the `@mention`, tidying the spacing around it.
* **Delete task/item/paragraph** deletes the whole task, item line or paragraph hosting the mention, after a confirmation.

If the page changed since it was last indexed, these actions leave the text untouched and show a notification instead of risking a bad edit.

# The `recipients` attribute
Every mention also sets a `recipients` attribute onto the object that hosts it, holding the canonical target(s) — the page name for a page-backed recipient, the `recipient:` identifier for an implicit one:
* a mention inside a task or list item stamps that task or item;
* a mention in a plain paragraph or header stamps the **page** object instead.

Pages can also declare recipients declaratively in frontmatter, by nickname or wiki link — useful when a whole page is “for” someone without inline mentions. Nicknames follow the same rules as inline mentions: a page-backed nickname stamps its page name, an unregistered one stamps its implicit `recipient:` identifier:

```yaml
---
recipients: ["petesmith", "[[Team/Operations]]"]
---
```

# Querying mentions
At-mentions are indexed like any other [[Object Index|relation]], with `kind == "at-mention"`. The `toTag` field says what kind of target a mention has: `"page"` for a page-backed recipient, `"recipient"` for an implicit one. Build your own view over them with SLIQ, for example:

```lua
${query[[
  from index.relations "at-mention"
  where _.to == "People/Pete Smith"
  select { page = _.page, snippet = _.snippet }
]]}
```
