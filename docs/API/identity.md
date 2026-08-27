---
tags: maturity/experimental api/space-lua
references:
- libraries/Library/Std/APIs/Identity.md
- plugs/index/identity.ts
---

APIs to define [[Concept/Identity|identities]] — the names you can address with `@name`, whether you're addressing them (see [[Concept/Recipient]]) or crediting them (see [[Concept/Authorship]]).

# API
## identity.define(def)
Defines an identity. Options:
* `name` _(required)_: the name it is addressed by, without the `@`. Matched case-insensitively.
* `description`: shown beside the name in autocomplete.

Accounts with access to the space are identities already and need no definition. Use this for teams, projects, agents — anything addressable that is not an account.

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

Both now complete after `@`, and mentions of them are collected in the [[Concept/Recipient#The Mention Inbox|Mention Inbox]] like any other.
