---
description: "The _CTX global gives Space Lua code access to context-specific values such as the current page."
tags: maturity/experimental
references:
- client/space_lua/runtime.ts
- client/space_lua/eval.ts
---

There is “magic” `_CTX` global variable available from which you can access some context-specific values. Currently the following keys are available:

* `_CTX.currentPage` providing access to the currently open page (PageMeta object)
