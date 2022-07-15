# Silver Bullet
## Markdown as a platform
Silver Bullet (SB) is a highly extensible, open source **personal knowledge playground**. At its core it’s a Markdown-based writing/note taking application that stores _pages_ (notes) as plain markdown files in a folder referred to as a _space_. Pages can be cross-linked using the `[[link to other page]]` syntax. This makes it a simple tool for [Personal Knowledge Management](https://en.wikipedia.org/wiki/Personal_knowledge_management). However, once you leverage its various extensions (called _plugs_) it can feel more like a _knowledge playground_, allowing you to annotate, combine and query your accumulated knowledge in creative ways, specific to you.

What does Silver Bullet look like? Well, have a look around. **You’re looking at it at this very moment!** Feel free to make some edits, to get a feel for it. Don’t worry, you won’t break anything, nothing is saved (just reload the page to see).

## Explore more
Click on the links below to explore various of Silver Bullet more in-depth:

[[🤯 Features]]
[[💡 Inspiration]]
[[🔌 Plugs]]
[[🔨 Development]]
[[🗺 Roadmap]]

More of a video person? Here’s two to get you started:

* [A Tour of Silver Bullet’s features](https://youtu.be/RYdc3UF9gok) — spoiler alert: it’s cool.
* [A look the SilverBullet architecture](https://youtu.be/mXCGau05p5o) — spoiler alert: it’s plugs all the way down.

## Installing and running Silver Bullet
Like what you’re seeing? Install it yourself locally or on your server! It’s free.

To run a release version, you need to have a recent version of [node.js installed](https://nodejs.org/en/) (16+) as well as some basic build infrastructure (make, cpp). Silver Bullet has only been tested on MacOS and Linux thus far.

To install and run, create a folder for your pages (can be empty or an existing folder with `.md` files) and run:

    npx @silverbullet/server <path-to-folder>

Optionally you can use the `--port` argument to specify a HTTP port (defaults to `3000`) and you can pass a `--password` flag to require a password to access. Note this is a rather weak security mechanism, so it’s recommended to add additional layers of security on top of this if you run this on a public server somewhere (at least add TLS). Personally I run it on a tiny Linux VM on my server at home, and use a VPN (Tailscale) to access it from outside my home.

