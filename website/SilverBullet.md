# Introduction
SilverBullet is a note-taking application optimized for people with a [hacker mindset](https://en.wikipedia.org/wiki/Hacker). We all take notes. There’s a million note taking applications out there. [Literally](https://www.noteapps.ca/). Wouldn’t it be nice to have one where your notes are _more_ than plain text files? Where your notes essentially become a _database_ that you can query; that you can build custom knowledge applications on top of? A _hackable notebook_, if you will?

This is what SilverBullet aims to be.

Absolutely. You use SilverBullet to quickly jot things down. It’s a notes app after all. However, this is just the beginning. Gradually, you start to annotate your notes using [[Frontmatter]]. You realize: “Hey, this note represents a _person_, let me [[Tags|tag]] it as such.” Before you know it, you’re turning your notes into [[Objects]]. Then you learn that in SilverBullet you can [[Live Queries|Live Query]] these objects. Your queries grow into reusable [[Templates]] written using a powerful [[Template Language]]. You find more and more uses of these templates, for instance to create [[Page Templates|new pages]], or [[Live Template Widgets|widgets]] automatically added to your pages.

And then, before you know it — you realize you’re effectively building applications in your notes app. [[End-User Programming]], y’all. It’s cool.

You may have been told there is _no such thing_ as a [silver bullet](https://en.wikipedia.org/wiki/Silver_bullet).

You were told wrong.

# What is SilverBullet?
SilverBullet is open source **personal knowledge management system** implemented as an offline-capable web application ([[PWA]]). In order to use it, you have to **self-host** it: that is, you need to run a web server either on your own machine, somewhere on your network, or in the cloud somewhere. See our [[Install|installation instructions]]. Yes, this requires a bit more work than downloading a desktop app. But you get a lot in return.

# Features
* SilverBullet is a **web application** and therefore instantly accessible wherever a (modern) web browser is available, without the need to install a 200mb Electron app, nor unreliable or proprietary sync setups.
* SilverBullet is a [[PWA]] that supports two [[Client Modes]]: [[Client Modes#Online mode]] and [[Client Modes#Synced mode]]), where the _synced mode_ enables **100% offline operation**, keeping a copy of the content in the browser’s local ([IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)) database, syncing back to the server when a network connection is available.
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

To get a feel of what SilverBullet is capable of, have a look at this introduction video:

```embed
url: https://youtu.be/8btx9HeuZ4s
```
If you want to dig deeper, there’s another video on [the template system](https://www.youtube.com/watch?v=ZiM1RM0DCgo).


# Try it
Here’s the kicker:

==You are looking at a (read-only) version of SilverBullet **right now**.==

That’s right, **this very website is powered by SilverBullet itself**. 🤯

Except... _you cannot edit anything_. But don’t despair, head to [play.silverbullet.md](https://play.silverbullet.md) and login with user `silverbullet`, and password `silverbullet` to get the editable experience (in an environment that resets itself every 15 minutes).

# Install SilverBullet
Convinced to install this yourself? Please proceed to [[Install]], and enjoy!

# What next?
* [[Manual]]: how to use this thing.
* [[CHANGELOG]]: we’re in active development, so things change rapidly. Watch this page to keep up.
* [Roadmap](https://github.com/orgs/silverbulletmd/projects/2/views/1): currently planned features and priorities.
* [Community](https://community.silverbullet.md): join our community: ask questions, share your experiences.
* [Issues](https://github.com/silverbulletmd/silverbullet/issues): if you have ideas or find bugs, please report them.
* [Discord](https://discord.gg/EvXbFucTxn): for more real-time support and discussion.
* [Mastodon](https://fosstodon.org/@silverbulletmd): follow SilverBullet development on [Mastodon](https://joinmastodon.org/).


# Support
If you (hypothetically) find bugs or have feature requests, post them in [our issue tracker](https://github.com/silverbulletmd/silverbullet/issues). Want to contribute? [Check out the code](https://github.com/silverbulletmd/silverbullet).

And... join our [community](https://community.silverbullet.md/)!