---
description: The neutral party behind an @name — an account, a defined identity, or anyone simply mentioned.
tags: glossary maturity/experimental
references:
- plugs/index/identity.ts
- libraries/Library/Std/APIs/Identity.md
- server/src/handlers/accounts.rs
---
An **identity** is anyone or anything addressable with `@name`, or an “at mention.” Identities are used in two contexts:

1. [[Concept/Recipient]]
2. [[Concept/Authorship]]

# Where identities come from
## Accounts
Everyone with access to the space is an identity, addressed by their account username.

## API-defined identities
Anything addressable that is not an account, but you’d still like to use as an identity, can be registered with `identity.define`:

```lua
identity.define {
  name = "sales",
  description = "Sales team",
}
```

Now `@sales` completes, shows “Sales team” beside it, and collects mentions in the Mention Inbox like anyone else. Because this is an ordinary [[Space Lua]] API, a library can register its own identities.

## Ad-hoc names
If you `@mention` any identity that’s neither an account nor API-defined identity, this will work as well. However, you will only get auto-complete for it once you’ve used it once.
