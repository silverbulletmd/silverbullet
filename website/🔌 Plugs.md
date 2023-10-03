SilverBullet at its core is bare bones in terms of functionality, most of its power it gains from **plugs**.

Plugs are an extension mechanism (implemented using a library called [[PlugOS]] that’s part of the silverbullet repo) that runs “plug” code in the browser using [web workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).

Plugs can hook into SB in various ways:

* Extend the Markdown parser and its syntax
* Define new commands and keybindings
* Respond to various events triggered either on the server or client-side
* Run recurring and background tasks.
* Define their own extension mechanisms through custom events

Each plug runs in its own _sandboxed environment_ and communicates with SB via _syscalls_ that expose a vast range of functionality. Plugs can be loaded, unloaded, and updated without having to restart SB itself.

Plugs are distributed as self-contained JavaScript bundles (ending with `.plug.js`). Upon boot, SB will load all core plugs bundled with SB itself (listed below), as well as any additional plugs stored in the `_plug` folder in your space. Typically, management of plugs in the `_plug` folder is done using [[🔌 Core/Plug Management]].

## Core plugs
These plugs are distributed with SilverBullet and are automatically enabled:
```query
plug where uri = null order by name render [[template/plug]]
```
## Third-party plugs
These plugs are written either by third parties or distributed separately from the main SB distribution:
```query
plug where uri != null order by name render [[template/plug]]
```

## How to develop your own plug
The easiest way to get started is to click the “Use this template” on the [silverbullet-plug-template](https://github.com/silverbulletmd/silverbullet-plug-template) repo.

Generally, every plug consists of a YAML manifest file named `yourplugname.plug.yml`. This file defines all functions that form your plug. To be loadable by SilverBullet (or any PlugOS-based system for that matter), it needs to be compiled into a JSON bundle (ending with `.plug.json`).

Generally, the way to do this is to run `silverbullet plug:compile` as follows:

```shell
silverbullet plug:compile yourplugname.plug.yaml
```

During development, you may want to compile plugs in debug mode, which will not minify them and generate source maps:

```shell
silverbullet plug:compile --debug yourplugname.plug.yaml
```

If you use the plug template, this command is wrapped in your `deno.jsonc` file, so you can just run either:

```shell
deno task build
```

to build it once, or

```shell
deno task watch
```

to build it and rebuild it when files are changed. This will write a `yourplugname.plug.js` file into the same folder.

Once you have a compiled `.plug.js` file you can load it into SB in a few ways by listing it in your space’s `PLUGS` page.

For development it’s easiest to simply copy the `.plug.js` file into your space’s `_plug/` folder:

```shell
cp myplug.plug.js ~/myspace/_plug/
```

Within seconds (watch your browser’s JavaScript console), your plug should be picked up, synced to your browser and loaded. No need to even reload the page.

## Debugging
Since plugs run in your browser, you can use the usual browser debugging tools. When you console.log things, these logs will appear in your browser’s JavaScript console.

## Distribution
Once you’re happy with your plug, you can distribute it in various ways:

- You can put it on github by simply committing the resulting `.plug.js` file there and instructing users to point to by adding
  `- github:yourgithubuser/yourrepo/yourplugname.plug.js` to their `PLUGS` file
- Add a release in your github repo and instruct users to add the release as `- ghr:yourgithubuser/yourrepo` or if they need a specific release `- ghr:yourgithubuser/yourrepo/release-name`
- You can put it on any other web server, and tell people to load it via https, e.g., `- https://mydomain.com/mypugname.plug.js`.
