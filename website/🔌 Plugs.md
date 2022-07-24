Silver Bullet at its core is bare bones in terms of functionality, most of its power it gains from **plugs**.

Plugs are an extension mechanism (implemented using a library called `plugos` that runs plug code on the server in a sandboxed v8 node.js process, and in the browser using web workers). Plugs can hook into SB in various ways: plugs can extend the Markdown parser and its syntax, define new commands and keybindings, respond to various events triggered either on the server or client side, as well as run recurring and background tasks. Plugs can even define their own extension mechanisms through custom events. Each plug runs in its own sandboxed environment and communicates with SB via _syscalls_ that expose a vast range of functionality. Plugs can be loaded, unloaded and updated without having to restart SB itself.

[[🔌 Plug Directory]]

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

## How to develop your own plug
At this stage, to get started, it’s probably easiest to fork one of the existing plugs found in the [SilverBullet github org](https://github.com/silverbulletmd), for instance the [github one](https://github.com/silverbulletmd/silverbullet-github).

Generally, every plug consists of a YAML manifest file named `yourplugname.plug.yml`. It’s convenient to have a `package.json` file in your repo to add any dependencies. One dev dependency you will definitely need is [@plugos/plugos](https://www.npmjs.com/package/@plugos/plugos) which will supply you with the `plugos-bundle` command, which is used to “compile” your plug YAML file into its bundled `.plug.json` form, which Silver Bullet will be able to load and execute.

Generally, the way to invoke `plugos-bundle` is as follows:

    plugos-bundle yourplugname.plug.yaml

This will write out a `yourplugname.plug.json` file into the same folder. For development it’s convenient to add a `-w` flag to automatically recompile when changes to the YAML or source files are detected.

In order to keep bundles somewhat small, a few dependencies come prebundled with SB. A the time of this writing:

* `yaml` (a YAML reader and stringifier library)
* `@lezer/lr` (a parser library)
* `handlebars`

If you use any of these, you can add e.g. `--exclude handlebars` to _not_ have them be included in the bundle (they will be loaded from SB itself).

Once you have a compiled `.plug.json` file you can load it into SB in a few ways by listing it in your space’s `PLUGS` page.

For development it’s easiest to use the `file:` prefix for this, by adding this in the `yaml` block section there to your existing list of plugs:

    - file:/home/me/git/yourplugname/yourplugname.plug.json

Reload your list of plugs via the `Plugs: Update` command (`Cmd-Shift-p` on Mac, `Ctrl-Shift-p` on Linux and Windows) to load the list of plugs from the various sources on the server and your browser client. No need to reload the page, your plugs are now active.

Once you’re happy with your plug, you can distribute it in various ways:

* You can put it on github by simply committing the resulting `.plug.json` file there and instructing users to point to by adding `- github:yourgithubuser/yourrepo/yourplugname.plug.json` to their `PLUGS` file
* Add a release in your github repo and instruct users to add the release as `- ghr:yourgithubuser/yourrepo` or if they need a spcecific release `- ghr:yourgithubuser/yourrepo/release-name`
* You can put it on any other web server, and tell people to load it via https, e.g. `- https://mydomain.com/mypugname.plug.json`.

### Recommended development workflow
I develop plugs as follows: in one terminal I have `plugos-bundle -w` running at all times, constantly recompiling my code as I change it.

I also have SB open with a `file:` based link in my `PLUGS` file.

Whenever I want to test a change, I switch to SB, hit `Cmd-Shift-p` and test if stuff works. 

Often I also have the `Debug: Show Logs` command running to monitor both server and client logs for any errors and debug information.
