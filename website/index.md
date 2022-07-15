# Silver Bullet
## Markdown as a platform
Silver Bullet (SB) is highly-extensible, open source **personal knowledge management** software. Indeed, that’s fancy language for “a note taking app with links.” 

At its core SB is a Markdown editor that stores _pages_ (notes) as plain markdown files in a folder referred to as a _space_. Pages can be cross-linked using the `[[link to other page]]` syntax. This makes it a great tool for [Personal Knowledge Management](https://en.wikipedia.org/wiki/Personal_knowledge_management). However, once you leverage its various extensions (called _plugs_) it can feel more like a _knowledge playground_, allowing you to annotate, combine and query your accumulated knowledge in creative ways, specific to you.

Cool, no?

What does Silver Bullet look like? Well, have a look around. **You’re looking at it at this very moment!**

Note that this is not a fully functional version, because the back-end is read only. However, it should give you some feel for what it’s like to use SB before making that massive commitment of running a single `npx` command (see below) to run it locally in its fully functioning mode.

Feel free to make some edits in this space. Don’t worry, you won’t break anything, nothing is saved (just reload the page to see).

Things to try:

* Click on the page name at the top, or hit `Cmd-k` (Mac) or `Ctrl-k` (Linux and Windows) to open the _page switcher_. Type the a name of a non-existing page to create it (although it won’t save in this environment).
* Click on the run button (top right) or hit `Cmd-/` (Mac) or `Ctrl-/` (Linux and Windows) to open the _command palette_ (note not all commands will work in this quasi read-only mode).
* Select some text and hit `Alt-m` to highlight it, or `Cmd-b` (Mac) or `Ctrl-b` to make it bold.
* Click a link below to navigate there
* Start typing `[[` somewhere to insert a page link (with completion)
* [ ] Tap this box 👈 to mark this task as done
* Start typing `:pa` to trigger the emoji picker 🎉
* Type `/` somewhere in the text to use a _slash command_.
* Open this site on your phone or tablet and… it just works! 

## Explore more
Click on the links below to explore various aspects of Silver Bullet more in-depth:

[[🤯 Features]]
[[💡 Inspiration]]
[[🔌 Plugs]]
[[🔨 Development]]
[[🗺 Roadmap]]

More of a video person? Here’s two to get you started:

* [A Tour of Silver Bullet’s features](https://youtu.be/RYdc3UF9gok) — spoiler alert: it’s cool.
* [A look the SilverBullet architecture](https://youtu.be/mXCGau05p5o) — spoiler alert: it’s plugs all the way down.

## Principles
Some core principles that underly Silver Bullet’s philosophy:

* **The truth is in the markdown.** And markdown is simply text files stored on disk. No proprietary formats or lock in. While SB uses a database for indexing and caching some data, all of that can be rebuilt from its markdown sources at any time.
* **What you see is what it is.** No magic or hidden content.
* **Single mode.** SB doesn’t have a separate view and edit mode. You’re always in edit mode, and you like it that way.
* **Extend it your way**. SB is highly extensible, and you can customize it your liking and your workflows.

## Installing and running Silver Bullet
Like what you’re seeing? Install it yourself locally or on your server! It’s free.

To run a release version, you need to have a recent version of [node.js installed](https://nodejs.org/en/) (16+) as well as some basic build infrastructure (make, cpp). Silver Bullet has only been tested on MacOS and Linux thus far.

To install and run, create a folder for your pages (can be empty or an existing folder with `.md` files) and run:

    npx @silverbulletmd/server <path-to-folder>

Optionally you can use the `--port` argument to specify a HTTP port (defaults to `3000`) and you can pass a `--password` flag to require a password to access. Note this is a rather weak security mechanism, so it’s recommended to add additional layers of security on top of this if you run this on a public server somewhere (at least add TLS). Personally I run it on a tiny Linux VM on my server at home, and use a VPN (Tailscale) to access it from outside my home.

