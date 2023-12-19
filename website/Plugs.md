SilverBullet at its core is bare bones in terms of functionality, most of its power it gains from **plugs**.

Plugs are an extension mechanism (implemented using a library called [[PlugOS]]) that runs “plug” code in the browser using [web workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).

Plugs can hook into SB in various ways:
* Extend the Markdown parser and its syntax
* Define new commands and keybindings
* Respond to various events triggered either on the server or client-side
* Run recurring and background tasks.
* Define their own extension mechanisms through custom events

Each plug runs in its own _sandboxed environment_ and communicates with SB via _syscalls_ that expose a vast range of functionality. Plugs can be loaded, unloaded, and updated without having to restart SilverBullet itself.

Plugs are distributed as self-contained JavaScript bundles (ending with `.plug.js`). SilverBullet will load all core plugs bundled with SB itself (listed below), as well as any additional plugs stored in the `_plug` folder in your [[Spaces|space]]. Typically, management of plugs in the `_plug` folder is done using [[Plug Management]].

# Core plugs
These plugs are distributed with SilverBullet and are automatically enabled:
```query
plug where uri = null order by name render [[template/plug]]
```

# Third-party plugs
These plugs are written either by third parties or distributed separately from the main SB distribution.
```query
plug where uri != null order by name render [[template/plug]]
```

Want to develop your own plugs? Have a look at [[Plugs/Development]].