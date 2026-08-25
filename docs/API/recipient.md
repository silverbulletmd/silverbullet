---
tags: maturity/experimental api/space-lua
references:
- libraries/Library/Std/APIs/Recipient.md
- plugs/index/recipient.ts
---

APIs to define [[Recipient|recipients]] — the names you can address with `@name`.

# API
## recipient.define(def)
Defines a recipient. Options:
* `name` _(required)_: the name it is addressed by, without the `@`. Matched case-insensitively.
* `description`: shown beside the name in autocomplete.

Accounts with access to the space are recipients already and need no definition. Use this for teams, projects, agents — anything addressable that is not an account.

## Example
```space-lua
recipient.define {
  name = "sales",
  description = "Sales team",
}

recipient.define {
  name = "ops",
  description = "Operations",
}
```

Both now complete after `@`, and mentions of them are collected in the [[Recipient#The Mention Inbox|Mention Inbox]] like any other.
