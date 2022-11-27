Silver Bullet is extensible, [open source](https://github.com/silverbulletmd/silverbullet), **personal
knowledge management** software. Indeed, at the most basic level that translates to “a note-taking app with links.” However, Silver Bullet goes a bit beyond just that.

Let’s have a look at some of its features.

## Features
* Runs in any modern browser (including mobile browsers) and is installable as a PWA.
* Provides a distraction-free, enjoyable markdown writing experience using [[Live Preview|live preview]] that **reduces visual noise**, but still gives direct access to the underlying [[Markdown]] syntax.
* Supports wiki-like page linking using the `[[page link]]` syntax, keeping links up-to-date as pages are renamed.
* Optimized for keyboard-based operation:
  * Quickly navigate between pages using the page switcher (triggered with `Cmd-k` on Mac or `Ctrl-k` on Linux and Windows).
  * Run commands via their keyboard shortcuts, or the command palette (triggered with `Cmd-/` or `Ctrl-/` on Linux and Windows).
  * Use [[🔌 Core/Slash Commands|slash commands]] to perform common text editing operations.
* Supports annotating pages with metadata (using [[Frontmatter]]).
* Provides a platform for [End-user Programming](https://www.inkandswitch.com/end-user-programming/) through its support of [[🔌 Directive|directives]] (such as [[🔌 Directive/Query|#query]]), which make parts of pages _dynamic_.
* Robust extension mechanism using [[🔌 Plugs]]
* You own your data. All content is stored as plain files in a folder on disk. Nothing fancy.
* Silver Bullet is [open source, MIT licensed](https://github.com/silverbulletmd/silverbullet) software.

## Try it
Here’s the kicker:

==You are looking at a (more or less) operational copy of Silver Bullet **right now**==.

That’s right, this very website is powered by a quasi-read-only version of Silver Bullet itself. 🤯

On this site, everything is editable as in a regular copy of Silver Bullet, just none of it persists (the back-end is read-only).

So, don’t just sit there, try this!

* Click on the page picker (folder tree) icon at the top right, or hit `Cmd-k` (Mac) or `Ctrl-k` (Linux and Windows) to open the **page switcher**. Type the name of a nonexistent page to create it (although it won’t save in this environment).
* Click on the run button (top right) or hit `Cmd-/` (Mac) or `Ctrl-/` (Linux and Windows) to open the **command palette** (note that not all commands will work in this mode).
* Select some text and hit `Alt-m` to ==highlight== it, or `Cmd-b` (Mac) or `Ctrl-b` to make it **bold**.
* Click a link somewhere on this page to navigate there.
* Start typing `[[` somewhere to insert a page link (with completion).
* [ ] Tap this box 👈 to mark this task as done.
* Start typing `:party` to trigger the emoji picker 🎉
* Type `/` somewhere in the text to invoke a **slash command**.
* Hit `Cmd-p` (Mac) or `Ctrl-p` (Windows, Linux) to show a live preview for the current page on the side, if your brain doesn’t speak native Markdown yet.
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

There are a few Features you don’t get to fully experience in this environment, because they rely on a working back-end, such as:

* Using Silver Bullet [[🔌 Directive|directives]] where part of pages are automatically rendered and kept up to date by querying various data sources (such as pages and their metadata, back links, tasks embedded in pages, and list items) with an SQL like syntax, rendered with handlebars templates.
* Intelligent **page renaming**, automatically updating any pages that link to it.
* **Full text search**.
* **Extending** and updating SB’s functionality by installing additional [[🔌 Plugs]] (SB parlance for plug-ins) and writing your own.


## Demo video
![Screencast screenshot](demo-video-screenshot.png)
Some things are just [better explained in a video](https://youtu.be/VemS-cqAD5k).

## Where to go from here
Click on the links below to explore various aspects of Silver Bullet more
in-depth:

* [[CHANGELOG|What’s new?]]
* [[💡 Inspiration]]: some of the projects that inspired Silver Bullet
* [[🔌 Plugs]]: extensions available in Silver Bullet
* [[🔨 Development]]: how to start hacking on Silver Bullet itself

## Installing Silver Bullet
This consists of two steps (unless Deno is already installed:

1. [Install Deno](https://deno.land/manual/getting_started/installation)
2. Installing Silver Bullet itself

### Install Silver Bullet
With [Deno installed](https://deno.land/manual/getting_started/installation), run:

```shell
deno install -f --name silverbullet -A --unstable https://get.silverbullet.md
```

This will install `silverbullet` into your `~/.deno/bin` folder (which should already be in your path if you followed the Deno install instructions).

To run Silver Bullet, create a folder for your pages (it can be empty, or be an existing folder with `.md` files) and run the following command in your terminal:

```shell
silverbullet <pages-path>
```

By default, Silver Bullet will bind to port `3000`, to use a different port use the the `--port` flag.

Once downloaded and booted, Silver Bullet will print out a URL to open SB in your browser (spoiler alert: by default this will be http://localhost:3000 ).

## Upgrading Silver Bullet
Simply run:

```shell
silverbullet upgrade
```

And restart Silver Bullet. You should be good to go.

## Support

If you (hypothetically) find bugs or have feature requests, post them in
[our issue tracker](https://github.com/silverbulletmd/silverbullet/issues). Want to contribute? [Check out the code](https://github.com/silverbulletmd/silverbullet). Want to chat with us? [We have a Mattermost instance](https://silverbullet.cloud.mattermost.com/), join us!
