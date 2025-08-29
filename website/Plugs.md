SilverBullet at its core is bare bones in terms of functionality, most of its power it gains from **plugs** and [[Space Lua]].

Plugs are an extension mechanism that runs “plug” code in the browser using [web workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).

Plugs can hook into SB in various ways:
* Define new commands and keybindings
* Respond to various events triggered either on the server or client-side
* Run recurring and background tasks.
* Define their own extension mechanisms through custom events

Each plug runs in its own _sandboxed environment_ and communicates with SB via _syscalls_ that expose a vast range of functionality. Plugs can be loaded, unloaded, and updated without having to restart SilverBullet itself.

Plugs are distributed as self-contained JavaScript bundles (ending with `.plug.js`). SilverBullet will load all core plugs bundled with SB itself (listed below), as well as any additional plugs stored in the `_plug` folder in your [[Spaces|space]].

# Available plugs
The [SilverBullet ‘Plugs’ category has a list of third-party plugs you can try](https://community.silverbullet.md/c/plugs/14).

Here are two popular ones:

* [SilverSearch](https://github.com/MrMugame/silversearch): implements a better full text search
* [TreeView](https://github.com/joekrill/silverbullet-treeview): adds a tree-view to your UI

# Development
Want to develop your own plugs? Have a look at [[Plugs/Development]].