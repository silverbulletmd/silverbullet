Silver Bullet is an extensible, [open source](https://github.com/silverbulletmd/silverbullet), **personal
knowledge management** system. Indeed, that’s fancy talk for “a note-taking app with links.” However, Silver Bullet goes a bit beyond just that.

You’ve been told there is _no such thing_ as a [silver bullet](https://en.wikipedia.org/wiki/Silver_bullet). You were told wrong.

Let’s have a look at some of Silver Bullet’s features.

## Features
* Runs in any modern browser (including on mobile) and is installable as a [PWA](https://web.dev/progressive-web-apps/).
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
* Silver Bullet is [open source, MIT licensed](https://github.com/silverbulletmd/silverbullet) software.

![Screencast screenshot](demo-video-screenshot.png)
To get a good feel of what Silver Bullet is capable of, [have a look at this introduction video](https://youtu.be/VemS-cqAD5k).

## Try it
Here’s the kicker:

==You are looking at a (more or less) operational copy of Silver Bullet **right now**==.

That’s right, **this very website is powered by Silver Bullet itself**. 🤯

On this site, everything is editable just none of it persists (the back-end is read-only). So, edit away, reload the page and everything resets.

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
  browser)? Click on that little icon to the right of your location bar that says “Install Silver Bullet” to give SB its own window frame and desktop icon, like it is a stand-alone app (not particularly useful on silverbullet.md, but definitely do this once you install it yourself).

Oh yeah, and you can use fancy things like tables:

| Page | Comment |
|----------|----------|
| [[Silver Bullet]] | Main product page |
| [[CHANGELOG]] | The latest updates |

or code snippets, like JavaScript:

```javascript
function helloWorld() {
   return "Hello there!"
}
```

or YAML:

```yaml
name: Silver Bullet
rating: 5
```

There are a few features you don’t get to fully experience in this environment, because they rely on a working back-end, such as:

* Any edits you make and pages you add aren’t saved (kind of useful).
* [[🔌 Directive|Directives]] are disabled, although you will see them being used across this site (look for sections with subtle curved lines around them, if you move your cursor inside you’ll see where their content is generated from), they just don’t update their content dynamically.
* **Full-text search**.
* **Extending** and updating SB’s functionality by installing additional [[🔌 Plugs]] (SB parlance for plug-ins) and writing your own.

## Where to go from here
Click on the links below to explore various aspects of Silver Bullet more in-depth:

* [[CHANGELOG]]: What’s new?
* [[🔌 Plugs]]: extensions available in Silver Bullet
* [[💡 Inspiration]]: some of the projects that inspired Silver Bullet
* [[🔨 Development]]: how to start hacking on Silver Bullet itself

## Installing Silver Bullet
This consists of two steps (unless Deno is already installed):

1. [Install Deno](https://deno.land/manual/getting_started/installation) (if you’re using a Raspberry Pi, follow [[Raspberry Pi Installation]]-specific instructions)
2. Installing Silver Bullet itself

### Install Silver Bullet
With Deno installed, run:

```shell
deno install -f --name silverbullet -A --unstable https://get.silverbullet.md
```

This will install `silverbullet` into your `~/.deno/bin` folder (which should already be in your `$PATH` if you followed the Deno install instructions).

To run Silver Bullet, create a folder for your pages (it can be empty, or be an existing folder with `.md` files) and run the following command in your terminal:

```shell
silverbullet <pages-path>
```

By default, Silver Bullet will bind to port `3000`, to use a different port use the `--port` flag. 

For security reasons, by default Silver Bullet only allows connections via `localhost` (or `127.0.0.1`). To also allow connections from the network, pass a `--hostname 0.0.0.0` flag, ideally combined with `--user username:password` to add BasicAuth password protection.

Once downloaded and booted, Silver Bullet will print out a URL to open SB in your browser.

## Upgrading Silver Bullet
Silver Bullet is regularly updated. To get the latest and greatest, simply run:

```shell
silverbullet upgrade
```

And restart Silver Bullet. You should be good to go.

## Support

If you (hypothetically) find bugs or have feature requests, post them in [our issue tracker](https://github.com/silverbulletmd/silverbullet/issues). Want to contribute? [Check out the code](https://github.com/silverbulletmd/silverbullet).

Want to chat with us? [We have a Mattermost instance](https://silverbullet.cloud.mattermost.com/), join us!
