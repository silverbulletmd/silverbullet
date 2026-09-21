---
tags: maturity/experimental api/space-lua
references:
- libraries/Library/Std/APIs/Identity.md
- plugs/index/identity.ts
---

APIs to define [[Identity|identities]] — the names you can address with `@name`, whether you're addressing them (see [[Recipient]]) or crediting them (see [[Authorship]]).

# API
## identity.define(def)
Defines an identity. Options:
* `name` _(required)_: the name it is addressed by, without the `@`. Matched case-insensitively.
* `description`: shown beside the name in autocomplete.

Accounts with access to the space are identities already and need no definition. Use this for teams, projects, agents — anything addressable that is not an account.

## identity.mentions(recipient?, options?)
Returns the same open mentions and page-level recipients used by the [[Recipient#The Mention Inbox|Mention Inbox]]. Pass a name with or without `@` to filter case-insensitively; omit it to include all recipients. Completed tasks are excluded.

```lua
identity.mentions("helper", {limit = 100, offset = 0})
```

The result contains `recipient` when filtered, `mentions`, `total`, and `truncated`. `limit` is optional; without it all remaining matches are returned. `offset` defaults to zero. Entries are ordered by page, UTF-16 position, and target identity. `total` counts all matches before pagination; `truncated` means more matches remain after the current page. Index changes between calls can affect pagination.

Each entry has `kind` (`mention` or `page`), `page`, `ref`, `target`, `snippet`, and `by` (author names). Inline mentions include `range`, `pos`, `nickname`, `fromTag`, and `inComment`. `replyTo` is the first signed author, or the current identity when no signed author is available; it is absent when neither is known. Page recipients use the current identity fallback, so inspect page authorship before replying. Signatures are self-declared and do not authenticate the author. References and offsets can become stale after an edit.

From the [[CLI]]:

```sh
sb --space notes eval 'identity.mentions("helper", {limit=100})' --json
```

## Example
```space-lua
identity.define {
  name = "sales",
  description = "Sales team",
}

identity.define {
  name = "ops",
  description = "Operations",
}
```

Both now complete after `@`, and mentions of them are collected in the [[Recipient#The Mention Inbox|Mention Inbox]] like any other.
