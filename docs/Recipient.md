---
description: A recipient is an identity you address with @name — collected in the Mention Inbox and queryable as `@name` relations.
tags: glossary maturity/experimental
references:
- plugs/index/relation.ts
- plugs/index/indexer.ts
- plugs/editor/navigate.ts
- libraries/Library/Std/Editor/Mention Inbox.md
---
A **recipient** is an [[Identity]] you address. When mentioned with `@name`, it is indexed to be queried, and clicking it in the editor will open the "Mentions Inbox". -- @zef

See [[At-Mention]] for the `@name` syntax, and [[Identity]] for where names come from (accounts, `identity.define`, or simply being mentioned).

# The Mention Inbox
The Mention Inbox is a sidebar view listing open `@mention`s, grouped by page. Open it with `Navigate: Mentions`, or by clicking any mention pill (which opens it pre-filtered on that recipient).

# The `recipients` attribute
Every mention also sets a `recipients` attribute onto the object that hosts it, holding the `@name` identifier of each name mentioned.
* a mention inside a task or list item stamps that task or item;
* a mention in a plain paragraph or header stamps the **page** object instead.

Pages can also declare recipients declaratively in frontmatter — useful when a whole page is “for” someone without inline mentions:

```yaml
---
recipients: ["petesmith", "sales"]
---
```

Like `tags`, the value can also be written as a plain string, cut on whitespace:

```yaml
---
recipients: petesmith sales
---
```

# Addressing vs. crediting
A mention only ever means one thing: *this is for you*. Marking text as *written by* someone instead uses a slightly different syntax, see [[Authorship]].

# Querying mentions
At-mentions are indexed like any other [[Object Index|relation]], with `kind == "at-mention"`. `to` is always the `@name` identifier (`toTag == "identity"`) and `alias` holds the name as typed. Build your own view over them with SLIQ, for example @pete.smith:

${query[[
  from index.relations "at-mention"
  where _.to == "@pete.smith"
  select { page = _.page, snippet = _.snippet }
]]}

Frontmatter declarations are relations too, with `kind == "recipients"`.
