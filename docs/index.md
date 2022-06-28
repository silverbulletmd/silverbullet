# Silver Bullet
Silver Bullet (SB) is a highly extensible, open source **personal knowledge playground**. At its core it’s a Markdown-based writing/note taking application that stores _pages_ (notes) as plain markdown files in a folder referred to as a _space_. Pages can be cross-linked using the `[[link to other page]]` syntax. This makes it a simple tool for [Personal Knowledge Management](https://en.wikipedia.org/wiki/Personal_knowledge_management). However, once you leverage its various extensions (called _plugs_) it can feel more like a _knowledge playground_, allowing you to annotate, combine and query your accumulated knowledge in creative ways, specific to you.

So what is it SB _really_? That is hard to answer. It can do a ton of stuff out of the box, and I’m constantly finding new use cases. It’s like... a silver bullet!

Here’s how I use it today (but this has grown significantly over time):

* Basic note taking, e.g. meeting notes, notes on books I read, blogs I read, podcasts I listen to, movies I watch.
* Getting a quick glance at the work people in my team are doing by pulling data from our 1:1 notes, recent activity on Github (such as recent pull requests) and other sources.
* Writing:
  * [My blog](https://zef.plus) is published via SB’s [Ghost](https://ghost.org) plugin.
  * An internal newsletter that I write is written in SB.
  * Performance reviews for my team (I work as a people manager) are written and managed using SB (for which I extensively use SB’s meta data features and query that data in various ways).
* A custom SB plugin aggregates data from our OpsGenie account every week, and publishes it to our [Mattermost](https://mattermost.com/) instance.
* It powers part of my smart home: I wired HomeBridge webhooks up to custom HTTP endpoints exposed by my custom smart home SB plug.

That’s a pretty crazy wide range of use cases!

I know, right?

**Disclaimer:** Silver Bullet is under heavy development and significant changes under the hood happen constantly. It’s also low on automated tests and documentation. All this will improve over time. I’ll do better, I promise.

[[🤯 Features]]
[[💡 Inspiration]]
[[🔌 Plugs]]
[[🔨 Development]]

## Installing and running Silver Bullet
To run a release version, you need to have a recent version of npm (8+) and node.js (16+) installed as well as some basic build infrastructure (make, cpp). Silver Bullet has only been tested on MacOS and Linux thus far.

To install and run, create a folder for your pages (can be empty or an existing folder with `.md` files) and run:

    npx @silverbullet/server <path-to-folder>

Optionally you can use the `--port` argument to specify a HTTP port (defaults to `3000`) and you can pass a `--password` flag to require a password to access. Note this is a rather weak security mechanism, so it’s recommended to add additional layers of security on top of this if you run this on a public server somewhere (at least add TLS). Personally I run it on a tiny Linux VM on my server at home, and use a VPN (Tailscale) to access it from outside my home.

## Roadmap
More details on the [[🗺️ Roadmap]] page.
<!-- #query task render "template/tasks" -->
* [ ] [[🗺️ Roadmap@34]] Persistent recent commands (saved between sessions)
* [ ] [[🗺️ Roadmap@92]] Add ==marker== syntax
* [ ] [[🗺️ Roadmap@120]] Two finger tap gesture to bring up command palette
* [ ] [[🗺️ Roadmap@177]] Change indent level command
* [ ] [[🗺️ Roadmap@212]] Keyboard shortcuts for specific notes (e.g. `index` note)
* [ ] [[🗺️ Roadmap@276]] RevealJS slides plug
* [ ] [[🗺️ Roadmap@303]] Pinned notes and actions?
* [ ] [[🗺️ Roadmap@335]] Template for deadline, with 📅 emoji and perhaps defaulting to today?
* [ ] [[🗺️ Roadmap@411]] Use webauthn https://www.npmjs.com/package/webauthn
* [ ] [[🗺️ Roadmap@469]] Proper sign up and login
* [ ] [[🗺️ Roadmap@500]] Data store pagination API
* [ ] [[🗺️ Roadmap@532]] Hashtag plug:
* [ ] [[🗺️ Roadmap@656]] Extract `MarkdownEditor` component.
* [ ] [[🗺️ Roadmap@725]] PUT page with `If-Last-Modified-Before` type header. Rejects if not matching. Client creates a revision, navigates to it.
* [ ] [[🗺️ Roadmap@858]] Put retries exponential back off
<!-- /query -->
