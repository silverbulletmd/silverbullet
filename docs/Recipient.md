---
description: Mention people, teams, or anything else worth addressing with @name.
tags: glossary maturity/experimental
references:
- plugs/index/recipient.ts
- plugs/index/relation.ts
- plugs/index/indexer.ts
- client/codemirror/at_mention.ts
- plugs/editor/navigate.ts
- libraries/Library/Std/APIs/Recipient.md
- libraries/Library/Std/Editor/Mention Inbox.md
- server/src/handlers/accounts.rs
---
A **recipient** is anything worth addressing directly: a team mate, a team, a project, anything you’d want to point at with @name. When used, it is indexed to be queried, and clicking it in the editor will open the “Mentions Inbox”.

# `@name` syntax
Type `@` followed by a name with no spaces, e.g. @ada. While typing, autocomplete offers every known recipient.

A name may contain dots, so dotted usernames carry whole: @pete.smith and @ada.b.lovelace are each one mention. A dot has to be followed by more name, which is what keeps a sentence-ending period out of it — "spoke to @pete." mentions `pete`, not `pete.`. A name may **not** contain `/`: that reads as a page separator, and a recipient is a name rather than a path, so `@ops/team` mentions `ops`. An `@` glued to a preceding word is never a mention, which is what keeps `pete@example.com` an email address.

**Any name is a valid mention.** Nothing needs declaring up front: mentioning @sales makes `sales` a recipient.

Your own name always completes too, labelled "you". In a deployment without accounts that name is `me`. Confusingly 😉

# Accounts
Everyone with access to the space is a recipient, addressed by their account username, with no setup at all. Their full name is shown beside the name while completing, so you can tell two similar usernames apart.

Your own account completes like anyone else's, labelled "you" instead of by your full name.

On a [[Space Manager|multi-space]] server the roster is the space's members plus the server's admins. In a single-space deployment and in the [[SilverBullet App|App]] there are no accounts at all, so recipients come only from `recipient.define` and from names you mention.

# Defined recipients
Anything addressable that is not an account — a team, a project, an agent — is registered with [[API/recipient#recipient.define(def)]]:

```lua
recipient.define {
  name = "sales",
  description = "Sales team",
}
```

Now `@sales` completes, shows "Sales team" beside it, and collects mentions in the Mention Inbox like anyone else. Because this is an ordinary [[Space Lua]] API, a library can register its own recipients — an agent integration adding `@claude`, say — without you creating anything in the space.

# The Mention Inbox
The Mention Inbox is a sidebar view listing open `@mention`s, grouped by page. Open it with `Navigate: Mentions`, or by clicking any mention pill (which opens it pre-filtered on that recipient).

It opens on **your own** mentions unless you have picked someone else — a choice it remembers, including an explicit "All Recipients". Where the space has no account for you — a deployment without accounts, or an anonymous reader of a public space — it opens on all recipients.

Hover a row for its actions:

* **Remove mention** deletes just the `@mention`, tidying the spacing around it.
* **Delete task/item/paragraph** deletes the whole task, item line or paragraph hosting the mention, after a confirmation.

If the page changed since it was last indexed, these actions leave the text untouched and show a notification instead of risking a bad edit.

Recipients declared in `recipients:` frontmatter (see below) are listed too, under their page and marked with an `@` icon. Such a declaration addresses the whole page rather than a spot in it, so the row shows the page's opening line, with the recipient it names as a chip beside it, and it carries neither of the two actions above — selecting one just opens the page.

# The `recipients` attribute
Every mention also sets a `recipients` attribute onto the object that hosts it, holding the `re:` identifier of each name mentioned.
* a mention inside a task or list item stamps that task or item;
* a mention in a plain paragraph or header stamps the **page** object instead.

Pages can also declare recipients declaratively in frontmatter — useful when a whole page is “for” someone without inline mentions:

```yaml
---
recipients: ["petesmith", "sales"]
---
```

Like `tags`, the value can also be written as a plain string, cut on whitespace — one recipient each — and a leading `@` is optional either way:

```yaml
---
recipients: petesmith sales
---
```

Autocomplete covers both halves: `recipients` is offered as an attribute name, and every known recipient is offered as a value. Note that an **unquoted `@` is a YAML syntax error** (the same trap `#` is for tags), so write `"@petesmith"` if you want to keep the sigil — completing a value drops it for you.

A declared name counts as a mention of that recipient everywhere else too: it makes the name a known recipient for autocomplete, and it shows up in the Mention Inbox's recipient dropdown.

A [[Link|wiki link]] written here is an ordinary page link, not a recipient: recipients are names.

# Querying mentions
At-mentions are indexed like any other [[Object Index|relation]], with `kind == "at-mention"`. `to` is always the `recipient:` identifier (`toTag == "recipient"`) and `alias` holds the name as typed. Build your own view over them with SLIQ, for example:

```lua
${query[[
  from index.relations "at-mention"
  where _.to == "re:petesmith"
  select { page = _.page, snippet = _.snippet }
]]}
```

Frontmatter declarations are relations too, with `kind == "recipients"`.