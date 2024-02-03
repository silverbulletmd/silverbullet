# Introduction
SilverBullet is a note-taking application optimized for people with a [hacker’s mindset](https://en.wikipedia.org/wiki/Hacker). We all take notes. There’s a million note taking applications out there. [Literally](https://www.noteapps.ca/). But wouldn’t it be nice to have one where your notes are more than plain text files. Where your notes essentially become a database that you can query; that you can build knowledge custom applications on top of?

This is what SilverBullet aims to be.

Absolutely. You use it to quickly jot things down. This is where it starts. Then, gradually, you start to annotate your notes using [[Frontmatter]]. You realize: “Hey, this note represents a _person_, let me [[Tags|tag]] it as such. This page represents a _meeting_, let me tag it as such.” Before you know it, you’re turning your notes into [[Objects]]. And then, you learn that in SilverBullet you can [[Live Queries|query]] these objects. Your queries grow into reusable [[Templates]] written using a simple yet powerful [[Template Language]]. You find more and more uses of these templates, for instance to create [[Page Templates|new pages]], or [[Live Template Widgets|widgets]] automatically added to your pages.

And then, before you know it — you realize you’re building [[End-User Programming|end-user programs]]. Just for you.

Welcome to the wondrous world of SilverBullet.

SilverBullet is _open source_ personal knowledge management system implemented as an _offline-capable_ web application ([[PWA]]). In order to use it, you have to _self-host_ it: that is, you need to run the web server either on your own machine, somewhere on your network, or in the cloud somewhere. See our [[Install|installation instructions]].

You may have been told there is _no such thing_ as a [silver bullet](https://en.wikipedia.org/wiki/Silver_bullet).

You were told wrong.

# Quick Links
* [[Install]]: how to install and deploy SilverBullet.
* [[Manual]]: how to use this thing.
* [[CHANGELOG]]: we’re in active development, so things change rapidly. Watch this page to keep up.
* [Roadmap](https://github.com/orgs/silverbulletmd/projects/2/views/1): currently planned features and priorities.
* [Community](https://community.silverbullet.md): join our community: ask questions, share your experiences.
* [Issues](https://github.com/silverbulletmd/silverbullet/issues): if you have ideas or find bugs, please report them.
* [Discord](https://discord.gg/EvXbFucTxn): for more real-time support and discussion.
* [Mastodon](https://fosstodon.org/@silverbulletmd): follow SilverBullet development on [Mastodon](https://joinmastodon.org/).

# Features
* SilverBullet is a **web application** and therefore instantly accessible wherever a (modern) web browser is available, without the need to install a 200mb Electron app, nor unreliable or proprietary sync setups.
* That said, SilverBullet is implemented as a [[PWA]] and supports two [[Client Modes]]: [[Client Modes#Online mode]] and [[Client Modes#Synced mode]]), where the _synced mode_ enables **100% offline operation**, keeping a copy of the content in the browser’s local ([IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)) database, syncing back to the server when a network connection is available.
* **Self-hosted**: _you own your data_. Your [[Spaces|space]] is stored as plain files in a folder on disk on your server. Back it up, sync, edit, publish, script it with any additional tools you like.
* SilverBullet provides an enjoyable [[Markdown]] writing experience with a clean UI, rendering text using [[Live Preview|live preview]], further **reducing visual noise** while still providing direct access to the underlying markdown syntax.
* SilverBullet supports wiki-style **page linking** using the `[[page link]]` syntax. Incoming links are indexed and appear as [[Linked Mentions]] at the bottom of the pages linked to, thereby providing _bi-directional linking_.
* SilverBullet is optimized for **keyboard-based operation**:
  * Quickly navigate between pages using the **page switcher** (triggered with `Cmd-k` on Mac or `Ctrl-k` on Linux and Windows).
  * Run commands via their keyboard shortcuts or the **command palette** (triggered with `Cmd-/` or `Ctrl-/` on Linux and Windows).
  * Use [[Slash Commands]] to perform common text editing operations.
* SilverBullet is a platform for [[End-User Programming]] through its support for [[Objects]], [[Live Queries]], [[Live Templates]] and [[Live Template Widgets]], allowing to make parts of your pages and UI dynamic.
* SilverBullet allows you to boost your writing/knowledge collection productivity using its various [[Templates]] mechanisms including powerful [[Snippets]] and [[Page Templates]].
* SilverBullet can be extended using [[Libraries]] and [[Plugs]].
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
Convinced to install this yourself? Please proceed to [[Install]], and enjoy!

# Support
If you (hypothetically) find bugs or have feature requests, post them in [our issue tracker](https://github.com/silverbulletmd/silverbullet/issues). Want to contribute? [Check out the code](https://github.com/silverbulletmd/silverbullet).

And... join our [community](https://community.silverbullet.md/)!