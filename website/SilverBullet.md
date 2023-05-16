SilverBullet is an extensible, [open source](https://github.com/silverbulletmd/silverbullet), **personal knowledge management** system. Indeed, that’s fancy talk for “a note-taking app with links.” However, SilverBullet goes a bit beyond _just_ that.

You’ve been told there is _no such thing_ as a [silver bullet](https://en.wikipedia.org/wiki/Silver_bullet). You were told wrong.

Before we get to the nitty gritty, some _quick links_ for the impatient reader: [[Download]], [[CHANGELOG]], [Roadmap](https://github.com/orgs/silverbulletmd/projects/2/views/1), [Issues](https://github.com/silverbulletmd/silverbullet/issues), [Discussions](https://github.com/silverbulletmd/silverbullet/discussions), [Mastodon](https://hachyderm.io/@silverbullet), [Discord](https://discord.gg/EvXbFucTxn), [Docker Hub](https://hub.docker.com/r/zefhemel/silverbullet).

Now that we got that out of the way, let’s have a look at some of SilverBullet’s features.

## Features
* Runs in any modern browser (including on mobile) as an **offline-first [[PWA]],** keeping the primary copy of your content in the browser, syncing back to the server when a network connection is available.
* Provides an enjoyable [[Markdown]] writing experience with a clean UI, rendering text using [[Live Preview|live preview]] further **reducing visual noise**, while still providing direct access to the underlying markdown syntax.
* Supports wiki-style **page linking** using the `[[page link]]` syntax, even keeping links up-to-date when pages are renamed.
* Optimized for **keyboard-based operation**:
  * Quickly navigate between pages using the **page switcher** (triggered with `Cmd-k` on Mac or `Ctrl-k` on Linux and Windows).
  * Run commands via their keyboard shortcuts, or the **command palette** (triggered with `Cmd-/` or `Ctrl-/` on Linux and Windows).
  * Use [[🔌 Core/Slash Commands|slash commands]] to perform common text editing operations.
* Provides a platform for [end-user programming](https://www.inkandswitch.com/end-user-programming/) through its support for annotating pages with [[Frontmatter]] and [[🔌 Directive|directives]] (such as [[🔌 Directive/Query|#query]]), making parts of pages _dynamic_.
* Experimental [[🔌 Collab|real-time collaboration support]].
* Robust extension mechanism using [[🔌 Plugs]].
* **Self-hosted**: you own your data. All content is stored as plain files in a folder on disk. Back up, sync, edit, publish, script with any additional tools you like.
* SilverBullet is [open source, MIT licensed](https://github.com/silverbulletmd/silverbullet) software.

To get a good feel of what SilverBullet is capable of, have a look at this introduction video.

```embed
url: https://youtu.be/VemS-cqAD5k
```

## Try it
Here’s the kicker:

==You are looking at a (more or less) operational copy of SilverBullet **right now**==.

That’s right, **this very website is powered by SilverBullet itself**. 🤯

On this site, everything is editable, just none of it syncs back (successfully) to the server. You are editing a local copy of this website, so changes do persist locally.

Don’t just sit there, try it!

* Click on the page picker (book icon) icon at the top right, or hit `Cmd-k` (Mac) or `Ctrl-k` (Linux and Windows) to open the **page switcher**. Type the name of a non-existent page to create it (although it won’t save in this environment).
* Click on the terminal button (top right) or hit `Cmd-/` (Mac) or `Ctrl-/` (Linux and Windows) to open the **command palette** (note that not all commands will work in this mode).
* Select some text and hit `Alt-m` to ==highlight== it, or `Cmd-b` (Mac) or `Ctrl-b` (Windows/Linux) to make it **bold**, or `Cmd-i` (Mac) or `Ctrl-i` (Windows/Linux) to make it _italic_.
* Click a link somewhere on this page to navigate there.
* Start typing `[[` somewhere to insert a page link (with completion).
* [ ] Tap this box 👈 to mark this task as done.
* Start typing `:party` to trigger the emoji picker 🎉
* Type `/` somewhere in the text to invoke a **slash command**.
* Hit `Cmd-p` (Mac) or `Ctrl-p` (Windows, Linux) to show a live preview for the current page on the side, if your brain doesn’t speak native Markdown yet.
* Click this button {[Editor: Toggle Vim Mode]} to toggle Vim mode
* Open this site on your phone or tablet and... it just works!
* Are you using a browser with **PWA support** (e.g. any Chromium-based
  browser)? Click on that little icon to the right of your location bar that says “Install SilverBullet” to give SB its own window frame and desktop icon, like it is a stand-alone app (not particularly useful on silverbullet.md, but definitely do this once you install it yourself). Now, unplug your network cable and reload the page. It still works!

Oh yeah, and you can use fancy things like tables:

| Page | Comment |
|----------|----------|
| [[SilverBullet]] | Main product page |
| [[CHANGELOG]] | The latest updates |

or code snippets, like JavaScript:

```javascript
function helloWorld() {
   return "Hello there!"
}
```

or YAML:

```yaml
name: SilverBullet
rating: 5
```

And here’s a query that lists all pages with back links to this particular page ([[SilverBullet]]), which is kept up to date automatically (learn more about [[🔌 Directive|directives]]).
<!-- #query link render [[template/page]] -->
* [[Raspberry Pi Installation]]
* [[index]]
* [[Sandbox]]
* [[Sandbox]]
* [[Sandbox]]
* [[Getting Started]]
* [[SilverBullet]]
* [[SilverBullet]]
* [[SilverBullet]]
* [[SilverBullet]]
<!-- /query -->


## Download SilverBullet
Has your mind been sufficiently blown to commit to an install? Took you long enough, alright then.

<!-- #include [[Download]] -->
Installing SilverBullet as a (local) web server is the most mature, and most flexible way to install SilverBullet. If mature and flexible is your thing, try this option!

The idea is simple: you run the web server (instructions below), point your browser at it and _go, go, go_! You can access the URL via your desktop browser, but also a mobile one. This makes it a great option to access your space from various devices without requiring any type of sync. You could even go _full-on YOLO_ (that’s a technical term), and install it on a public cloud server somewhere and access it that way (be sure to at least enable authentication and put SSL on top of it, though).

You have two options to install and run SilverBullet as a server:

1. Installation via Deno on your host system
2. Running it with Docker

## Installation via Deno
This consists of two steps (unless Deno is already installed — in which case we’re down to one):

1. [Install Deno](https://deno.land/manual/getting_started/installation) (if you’re using a Raspberry Pi, follow [[Raspberry Pi Installation]]-specific instructions)
2. Installing SilverBullet itself

### Install SilverBullet
With Deno installed, run:

```shell
deno install -f --name silverbullet -A --unstable https://get.silverbullet.md
```

This will install `silverbullet` into your `~/.deno/bin` folder (which should already be in your `$PATH` if you followed the Deno install instructions).

To run SilverBullet, create a folder for your pages (it can be empty, or be an existing folder with `.md` files) and run the following command in your terminal:

```shell
silverbullet <pages-path>
```

By default, SilverBullet will bind to port `3000`, to use a different port use the `--port` flag. 

For security reasons, by default SilverBullet only allows connections via `localhost` (or `127.0.0.1`). To also allow connections from the network, pass a `--hostname 0.0.0.0` flag (0.0.0.0 for all connections, or insert a specific address to limit the host), ideally combined with `--user username:password` to add BasicAuth password protection.

Once downloaded and booted, SilverBullet will print out a URL to open SB in your browser.

## Upgrading SilverBullet
SilverBullet is regularly updated. To get the latest and greatest, simply run:

```shell
silverbullet upgrade
```

And restart SilverBullet. You should be good to go.

## Installing SilverBullet with Docker

There is a [docker image on docker hub](https://hub.docker.com/r/zefhemel/silverbullet). To use it, first create a volume to keep your space (markdown) files:

```shell
docker volume create myspace
```

Then, run the container, e.g. as follows:

```shell
docker run -p 3000:3000 -v myspace:/space -d --name silverbullet zefhemel/silverbullet
```

If you'd like to pass in additional command line arguments (e.g. `--user` to add authentication) you can just append those to the command, e.g.:

```shell
docker run -p 3000:3000 -v myspace:/space -d --name silverbullet zefhemel/silverbullet --user me:letmein
```

To build your own version of the docker image, run `./scripts/build_docker.sh`.

You can also use docker-compose if you prefer. From a silverbullet check-out run:

```shell
PORT=3000 docker-compose up
```

or similar.

To upgrade, simply pull the latest docker image (rebuilt and pushed after every commit to "main") and start the new container.

```shell
docker pull zefhemel/silverbullet
```
<!-- /include -->

## Where to go from here
Click on the links below to explore various aspects of SilverBullet more in-depth:

* [[CHANGELOG]]: What’s new?
* [[🔌 Plugs]]: extensions available for, and as part of SilverBullet
* [[SETTINGS]]: What settings exist and how to change them
* [[Special Pages]]: a few page names in Silver Bullet have special meaning
* [[🔨 Development]]: how to start hacking on SilverBullet itself

## Support
If you (hypothetically) find bugs or have feature requests, post them in [our issue tracker](https://github.com/silverbulletmd/silverbullet/issues). Want to contribute? [Check out the code](https://github.com/silverbulletmd/silverbullet).

Want to chat with us? [Join our Discord](https://discord.gg/EvXbFucTxn)!
