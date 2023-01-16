SilverBullet at its core is bare bones in terms of functionality, most of its power it gains from **plugs**.

Plugs are an extension mechanism (implemented using a library called PlugOS that’s part of the silverbullet repo) that runs “plug” code on the server in Deno web workers ([with severely locked down permissions](https://deno.land/manual@v1.28.2/runtime/workers#instantiation-permissions)), and in the browser using web workers.

Plugs can hook into SB in various ways:

* Extend the Markdown parser and its syntax
* Define new commands and keybindings
* Respond to various events triggered either on the server or client-side
* Run recurring and background tasks.
* Define their own extension mechanisms through custom events

Each plug runs in its own _sandboxed environment_ and communicates with SB via _syscalls_ that expose a vast range of functionality. Plugs can be loaded, unloaded, and updated without having to restart SB itself.

Plugs are distributed as self-contained JSON files (ending with `.plug.json`). Upon boot, SB will load all core plugs bundled with SB itself (listed below), as well as any additional plugs stored in the `_plug` folder in your space. Typically, management of plugs in the `_plug` folder is done using [[🔌 Core/Plug Management]].

## Core plugs
These plugs are distributed with SilverBullet and are automatically enabled:
<!-- #query page where type = "plug" and uri = null order by name render [[template/plug]] -->
* [[🔌 Collab]]  
* [[🔌 Core]]  
* [[🔌 Directive]]  
* [[🔌 Emoji]]  
* [[🔌 Markdown]]  
* [[🔌 Share]]  
* [[🔌 Tasks]]
<!-- /query -->
## Third-party plugs
These plugs are written either by third parties or distributed separately from the main SB distribution:
<!-- #query page where type = "plug" and uri != null order by name render [[template/plug]] -->
* [[🔌 Backlinks]] by **Guillermo Vayá** ([repo](https://github.com/Willyfrog/silverbullet-backlinks)) 
* [[🔌 Ghost]] by **Zef Hemel** ([repo](https://github.com/silverbulletmd/silverbullet-ghost)) 
* [[🔌 Git]] by **Zef Hemel** ([repo](https://github.com/silverbulletmd/silverbullet-github)) 
* [[🔌 Github]] by **Zef Hemel** ([repo](https://github.com/silverbulletmd/silverbullet-github)) 
* [[🔌 Graph View]] by **Bertjan Broeksema** ([repo](https://github.com/bbroeksema/silverbullet-graphview)) 
* [[🔌 KaTeX]] by **Zef Hemel** ([repo](https://github.com/silverbulletmd/silverbullet-katex)) 
* [[🔌 Mattermost]] by **Zef Hemel** ([repo](https://github.com/silverbulletmd/silverbullet-mattermost)) 
* [[🔌 Mermaid]] by **Zef Hemel** ([repo](https://github.com/silverbulletmd/silverbullet-mermaid)) 
* [[🔌 Serendipity]] by **Pantelis Vratsalis** ([repo](https://github.com/m1lt0n/silverbullet-serendipity)) 
* [[🔌 Twitter]] by **Silver Bullet Authors** ([repo](https://github.com/silverbulletmd/silverbullet-twitter))
<!-- /query -->
## How to develop your own plug
The easiest way to get started is to click the “Use this template” on the [silverbullet-plug-template](https://github.com/silverbulletmd/silverbullet-plug-template) repo.

Generally, every plug consists of a YAML manifest file named `yourplugname.plug.yml`. This file defines all functions that form your plug. To be loadable by SilverBullet (or any PlugOS-based system for that matter), it needs to be compiled into a JSON bundle (ending with `.plug.json`).

Generally, the way to do this is to run `silverbullet plug:compile` as follows:

```shell
silverbullet plug:compile yourplugname.plug.yaml
```

However, if you use the plug template, this command is wrapped in your `deno.jsonc` file, so you can just run either:

```shell
deno task build
```

to build it once, or

```shell
deno task watch
```

to build it and rebuild when files are changed. This will write a `yourplugname.plug.json` file into the same folder.

Once you have a compiled `.plug.json` file you can load it into SB in a few ways by listing it in your space’s `PLUGS` page.

For development it’s easiest to use the `file:` prefix for this, by adding this in the `yaml` block section there to your existing list of plugs:

```yaml
- file:/home/me/git/yourplugname/yourplugname.plug.json
```

Reload your list of plugs via the `Plugs: Update` command (`Cmd-Shift-p` on Mac, `Ctrl-Shift-p` on Linux and Windows) to load the list of plugs from the various sources on the server and your browser client. No need to reload the page, your plugs are now active.

Once you’re happy with your plug, you can distribute it in various ways:

- You can put it on github by simply committing the resulting `.plug.json` file there and instructing users to point to by adding
  `- github:yourgithubuser/yourrepo/yourplugname.plug.json` to their `PLUGS` file
- Add a release in your github repo and instruct users to add the release as `- ghr:yourgithubuser/yourrepo` or if they need a specific release `- ghr:yourgithubuser/yourrepo/release-name`
- You can put it on any other web server, and tell people to load it via https, e.g. `- https://mydomain.com/mypugname.plug.json`.

### Recommended development workflow
I develop plugs as follows: in one terminal I have `deno task watch` running at all times, constantly recompiling my code as I change it.

I also have SB open with a `file:` based link in my `PLUGS` file.

Whenever I want to test a change, I switch to SB, hit `Cmd-Shift-p` and test if stuff works.

Often I also have the `Debug: Show Logs` command running to monitor both server and client logs for any errors and debug information.
