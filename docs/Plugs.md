---
references:
- client/plugos/*
- plugs/builtin_plugs.ts
lastReviewed: 2026-08-03
---
SilverBullet at its core is bare bones in terms of functionality, most of its power it gains from **plugs** and [[Space Lua]].

Plugs are an extension mechanism that runs “plug” code in the browser using [web workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).

Plugs can hook into SB in various ways:
* Define new commands and keybindings
* Respond to various events triggered either on the server or client-side
* Run recurring and background tasks.
* Define their own extension mechanisms through custom events

Each plug runs in its own _sandboxed environment_ and communicates with SB via _syscalls_ that expose a vast range of functionality. Plugs can be loaded, unloaded, and updated without having to restart SilverBullet itself.

These days, plugs are distributed as assets attached to [[Concept/Library|libraries]], ending in a file name with `.plug.js`. 

# Available plugs
You can discover libraries and plugs via the [SilverBullet ‘Plugs and Libraries’](https://community.silverbullet.md/c/plugs/14) or through [[Feature/Configuration Manager#Libraries]].

# Development
Want to develop your own plugs? Have a look at [[Plugs/Development]].
