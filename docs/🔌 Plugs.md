Silver Bullet at its core is bare bones in terms of functionality, most of its power it gains from **plugs**.

Plugs are an extension mechanism (implemented using a library called `plugos` that runs plug code on the server in a sandboxed v8 node.js process, and in the browser using web workers). Plugs can hook into SB in various ways: plugs can extend the Markdown parser and its syntax, define new commands and keybindings, respond to various events triggered either on the server or client side, as well as run recurring and background tasks. Plugs can even define their own extension mechanisms through custom events. Each plug runs in its own sandboxed environment and communicates with SB via _syscalls_ that expose a vast range of functionality. Plugs can be loaded, unloaded and updated without having to restart SB itself.

Examples of functionality implemented as plugs:

* _Core functionality_ such as:
  * Navigation between pages by clicking or hitting `Cmd/Ctrl-Enter`
  * Page auto complete when using the `[[page link]]` syntax
  * Indexing of cross-page links and automatically updating all references to them when a page is renamed
  * Text editing commands such as bold (`Cmd/Ctrl-b`) and italics (`Cmd/Ctrl-i`) or quote or itemize entire sections.
  * Full text indexing and search
* Slash commands such as `/today`, `/tomorrow` and `/meta` (to insert page meta data)
* Emoji auto complete using the `:emoji:` syntax
* An embedded query language that can be used to query various sets of indexed entities, such as:
  * Tasks using the Markdown task syntax
  * Page backlinks
  * Page in your space and its meta data
  * Data objects embedded in your pages
* Git integration
* Github integration