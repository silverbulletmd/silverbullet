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
* [[CHANGELOG]]: we’re in active development, so things change rapidly, watch this page to keep up.
* Development:
  * [Roadmap](https://github.com/orgs/silverbulletmd/projects/2/views/1): currently planned features and priorities.
  * [Issues](https://github.com/silverbulletmd/silverbullet/issues): if you have ideas, or find bugs, please report them.
  * [Discussions](https://github.com/silverbulletmd/silverbullet/discussions): got ideas for features or questions? Ask them here.
* Socials:
  * [Mastodon](https://fosstodon.org/@silverbulletmd): follow SilverBullet development on [Mastodon](https://joinmastodon.org/)
  * [Discord](https://discord.gg/EvXbFucTxn): for more real-time support and discussion, join our Discord!

# Features
Some highlights:

* SilverBullet runs in any modern browser (including mobile ones) as a [[PWA]] in two [[Client Modes]] ([[Client Modes$online|online]] and [[Client Modes$sync|synced]] mode), where the _synced mode_ enables **100% offline operation**, keeping a copy of content in the browser’s local ([IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)) database, syncing back to the server when a network connection is available.
* SilverBullet provides an enjoyable [[Markdown]] writing experience with a clean UI, rendering text using [[Live Preview|live preview]], further **reducing visual noise** while still providing direct access to the underlying markdown syntax.
* SilverBullet supports wiki-style **page linking** using the `[[page link]]` syntax. Incoming links are indexed and appear as [[Linked Mentions]] at the bottom of the pages linked to thereby providing _bi-directional linking_.
* SilverBullet allows you to boost your writing/knowledge collection productivity using its various [[Templates]] mechanism.
* SilverBullet is optimized for **keyboard-based operation**:
  * Quickly navigate between pages using the **page switcher** (triggered with `Cmd-k` on Mac or `Ctrl-k` on Linux and Windows).
  * Run commands via their keyboard shortcuts or the **command palette** (triggered with `Cmd-/` or `Ctrl-/` on Linux and Windows).
  * Use [[Slash Commands]] to perform common text editing operations.
* SilverBullet is a platform for [[End-User Programming]] through its support for [[Objects]], [[Live Queries]] and [[Live Templates]], allowing to make parts of your pages _dynamic_.
* SilverBullet can be extended using [[Plugs]].
* **Self-hosted**: you own your data. All content is stored as plain files in a folder on disk (if you so choose). Back up, sync, edit, publish, script with any additional tools you like.
* SilverBullet is free, [**open source**, MIT licensed](https://github.com/silverbulletmd/silverbullet) software.

To get a feel of what SilverBullet is capable of, have a look at this (always ever so slightly out of date) introduction video.

```embed
url: https://youtu.be/BbNbZgOwB-Y
```

# Try it
Here’s the kicker:

==You are looking at a (more or less) operational copy of SilverBullet **right now**.==

That’s right, **this very website is powered by SilverBullet itself**. 🤯

On this site, everything is editable just none of it syncs back (successfully) to the server. You are editing a local copy of this website, so changes do persist locally. It’s not a perfect rendition of the actual SilverBullet experience, but it's pretty close.

Don’t just sit there, try it!

* Click on the page picker (book icon) icon at the top right, or hit `Cmd-k` (Mac) or `Ctrl-k` (Linux and Windows) to open the **page switcher**. Type the name of a non-existent page to create it (although it won’t save in this environment).
* Click on the terminal button (top right) or hit `Cmd-/` (Mac) or `Ctrl-/` (Linux and Windows) to open the **command palette** (note that not all commands will work in this mode).
* Select some text and hit `Alt-m` to ==highlight== it, or `Cmd-b` (Mac) or `Ctrl-b` (Windows/Linux) to make it **bold**, or `Cmd-i` (Mac) or `Ctrl-i` (Windows/Linux) to make it _italic_.
* Click a link somewhere on this page to navigate there.
* Start typing `[[` somewhere to insert a page link (with completion).
* [ ] Tap this box 👈 to mark this task as done.
* Start typing `:party` to trigger the emoji picker 🎉
* Type `/` somewhere in the text to invoke a **slash command**.
* Click this button {[Editor: Toggle Vim Mode]} to toggle Vim mode
* Open this site on your phone or tablet and... it just works!
* Are you using a browser with **PWA support** (e.g., any Chromium-based
  browser or recent version of Safari)? Click on that little icon to the right of your location bar that says “Install SilverBullet” to give SB its own window frame and desktop icon, like it is a stand-alone app (not particularly useful on silverbullet.md, but definitely do this once you install it yourself). Now, unplug your network cable and reload the page. It still works!

At the core of SilverBullet is [[Markdown]] with some added fancier features like tables:

| Page | Comment |
|----------|----------|
| [[SilverBullet]] | Main product page |
| [[CHANGELOG]] | The latest updates |

or code snippets, like JavaScript:

```javascript
function helloWorld() {
   return "Look at my I'm JavaScript!";
}
```

# Beyond Markdown
Where things get slightly more interesting is when using features like [[Live Queries]] that allow you to query all types of [[Objects]] indexed based on the pages in your [[Spaces]]. 

Let’s explore this with a meta example of using this functionality for this very website. All pages in this space that represent a [[Plugs|plug]] are tagged with the `#plug` [[Tags|tag]]. Now, if we want to render a list of all plugs in one place using the [[template/plug]] template, we can simply do this as follows:

```query
plug render [[template/plug]]
```

Hover over that list and click the edit button to see the query that generates this view.

And it’s not just pages that can be queried, there’s a large variety of queriable sources and you can define your own via tags. Examples include `task`s, `page`s, `tag`s, and `link`s. The sky is the limit. See [[Objects]] and [[Live Queries]] for more information.

# Install SilverBullet
Has your mind been sufficiently blown to commit to an install? Took you long enough, alright then. Please proceed to [[Install]] and enjoy!

# Support
If you (hypothetically) find bugs or have feature requests, post them in [our issue tracker](https://github.com/silverbulletmd/silverbullet/issues). Want to contribute? [Check out the code](https://github.com/silverbulletmd/silverbullet).

Want to chat with us? [Join our Discord](https://discord.gg/EvXbFucTxn)!