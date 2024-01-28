# Introduction
SilverBullet aims to be a **workshop for the mind**: a creative [[Spaces|space]] where you collect, create and expand your personal knowledge, while simultaneously letting you evolve the tools you use to do so.

So yeah, SilverBullet is basically a geeky note-taking application and personal wiki.

While you _can_ use SilverBullet as just a note-taking application that stores notes in plain [[Markdown]] files on disk; it becomes truly powerful in the hands of more technical power users. By leveraging [[Metadata]] annotations, its [[Objects]] infrastructure, [[Live Queries]] and [[Live Templates]], it becomes a powerful [[End-User Programming]] tool, enabling you to quickly develop various types of ad-hoc knowledge systems.

SilverBullet is _open source_ and implemented as an _offline-capable_ web application ([[PWA]]). In order to use it, you have to _self-host_ it: that is, you need to run the web server either on your own machine, somewhere on your network, or in the cloud somewhere. See our [[Install|installation instructions]].

You may have been told there is _no such thing_ as a [silver bullet](https://en.wikipedia.org/wiki/Silver_bullet).

You were told wrong.

# Quick Links
* [[Install]]: how to install and deploy SilverBullet.
* [[Manual]]: how to use this thing.
* [[CHANGELOG]]: we’re in active development, so things change rapidly. Watch this page to keep up.
* [Roadmap](https://github.com/orgs/silverbulletmd/projects/2/views/1): currently planned features and priorities.
* [Issues](https://github.com/silverbulletmd/silverbullet/issues): if you have ideas or find bugs, please report them.
* [Community](https://community.silverbullet.md): join our community!
* [Discord](https://discord.gg/EvXbFucTxn): for more real-time support and discussion!
* [Mastodon](https://fosstodon.org/@silverbulletmd): follow SilverBullet development on [Mastodon](https://joinmastodon.org/)

# Features
Some highlights:

* SilverBullet runs in any modern browser (including mobile ones) as a [[PWA]] in two [[Client Modes]] ([[Client Modes$online|online]] and [[Client Modes$sync|synced]] mode), where the _synced mode_ enables **100% offline operation**, keeping a copy of the content in the browser’s local ([IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)) database, syncing back to the server when a network connection is available.
* SilverBullet provides an enjoyable [[Markdown]] writing experience with a clean UI, rendering text using [[Live Preview|live preview]], further **reducing visual noise** while still providing direct access to the underlying markdown syntax.
* SilverBullet supports wiki-style **page linking** using the `[[page link]]` syntax. Incoming links are indexed and appear as [[Linked Mentions]] at the bottom of the pages linked to, thereby providing _bi-directional linking_.
* SilverBullet is optimized for **keyboard-based operation**:
  * Quickly navigate between pages using the **page switcher** (triggered with `Cmd-k` on Mac or `Ctrl-k` on Linux and Windows).
  * Run commands via their keyboard shortcuts or the **command palette** (triggered with `Cmd-/` or `Ctrl-/` on Linux and Windows).
  * Use [[Slash Commands]] to perform common text editing operations.
* SilverBullet is a platform for [[End-User Programming]] through its support for [[Objects]], [[Live Queries]], [[Live Templates]] and [[Live Template Widgets]], allowing to make parts of your pages and UI dynamic.
* SilverBullet allows you to boost your writing/knowledge collection productivity using its various [[Templates]] mechanisms.
* SilverBullet can be extended using [[Libraries]] and [[Plugs]].
* **Self-hosted**: you own your data. All content is stored as plain files in a folder on disk (if you so choose). Back up, sync, edit, publish, script with any additional tools you like.
* SilverBullet is free, [**open source**, MIT licensed](https://github.com/silverbulletmd/silverbullet) software.

To get a feel of what SilverBullet is capable of, have a look at this (always ever so slightly out of date) introduction video.

```embed
url: https://youtu.be/BbNbZgOwB-Y
```

# Try it
Here’s the kicker:

==You are looking at a (read-only) version of SilverBullet **right now**.==

That’s right, **this very website is powered by SilverBullet itself**. 🤯

Except... _you cannot edit anything_. But don’t despair, head to [play.silverbullet.md](https://play.silverbullet.md) and login with user `silverbullet`, and password `silverbullet` to get the editable experience (in an environment that resets itself every 15 minutes).

# Install SilverBullet
Has your mind been sufficiently blown to commit to an install? Took you long enough, alright then. Please proceed to [[Install]] and enjoy!

# Support
If you (hypothetically) find bugs or have feature requests, post them in [our issue tracker](https://github.com/silverbulletmd/silverbullet/issues). Want to contribute? [Check out the code](https://github.com/silverbulletmd/silverbullet).

And... join our [community](https://community.silverbullet.md/)!