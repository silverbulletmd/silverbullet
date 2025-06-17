# Introduction
SilverBullet is a tool to **develop**, **organize**, and **structure** your personal knowledge and to make it **universally accessible** across all your devices. 

In SilverBullet you keep your content as a collection of [[Markdown]] [[Pages]] (called a [[Spaces|Space]]). You navigate your space using the [[Page Picker]] like a traditional notes app, or through [[Links]] like a wiki (except they are [[Linked Mentions|bi-directional]]). 

If you are the **writer** type, you’ll appreciate SilverBullet as a clean [[Markdown]] editor with [[Live Preview]]. If you have more of an **outliner** personality, SilverBullet has [[Outlines|Outlining]] tools for you. Productivity freak? Have a look at [[Tasks]]. More of a **database** person? You will appreciate [[Objects]] and [[Space Lua/Lua Integrated Query|Queries]]. 

And if you are comfortable writing (or learning) some **code**, you will love dynamically generating content with [[Space Lua]] (SilverBullet’s [[Lua]] dialect), and use it to create custom [[Commands]] and [[Space Lua/Widgets]], and possibly use [[Space Style]] to personalize your Space’s look and feel.

For instance, want to insert a list of your last 5 modified pages? Just write a little query and render it as a list of page links (`Alt-click` to see the underlying code):

${template.each(query[[
  from index.tag "page"
  order by _.lastModified desc
  limit 5
]], templates.pageItem)}

Want to collect all [[Tasks]] that you have not yet completed from across your space? No problem:

${template.each(query[[
  from index.tag "task" where not _.done
  limit 3
]], templates.taskItem)}

And all of this is free and **open source** 🤯

That all sounds nice, but what does that look like in practice?
${embed.youtube "https://www.youtube.com/watch?v=mik1EbTshX4"}
> **warning** Attention
> You are looking at the documentation of SilverBullet **v2**. Migrating from v1? Check out the [[Migrate from v1]] docs. There is also the [v1 website](https://v1.silverbullet.md).

# Installing
SilverBullet is a **self-hosted web application**. You need to install it on a server. Perhaps you do this on a Raspberry Pi you didn’t have a use for, or a VPS somewhere in the cloud. SilverBullet is distributed as a single self-contained server [[Install/Binary]] or [[Install/Docker]] container. While this is a bit more complicated to set up than simply downloading a desktop or mobile app, since your space is centrally stored on a server under your control, you can now access it from anywhere you can access your server. And it may well be your gateway to [[Self Hosting]] more interesting applications.

The SilverBullet client is built as a [[Local First]], [[PWA|progressive web application]], syncing all your content into your browser’s local storage, enabling **instant access** to your entire space whether you are **online** or **offline**. Simply opt to “Install SilverBullet” from your browser (in any Chrome-based browser), add it to your Dock or home screen (Safari and Android), and voila: SilverBullet becomes indistinguishable from a regular desktop or mobile app. You can try it right here — in case you hadn’t figured out: this very website runs as a (read-only) SilverBullet instance!
![[pwa-screenshot.png]]

Unplug your (hypothetical) network cable, and everything still works!

# Features
So, what is SilverBullet? Like... _really._

* SilverBullet at its core is a **note taking** application, a kind of personal wiki, storing its notes in the universal [[Markdown]] format in a folder on your server.
* SilverBullet provides an enjoyable [[Markdown]] writing experience with a clean UI, rendering text using [[Live Preview|live preview]], further **reducing visual noise** while still providing direct access to the underlying markdown syntax. It has convenient [[Commands]] and keyboard shortcuts, to e.g. make text bold or italic, and [[Slash Commands]] for more advanced text manipulation.
* SilverBullet supports wiki-style **page linking** using the `[[page link]]` syntax. Incoming links are indexed and appear as [[Linked Mentions]] at the bottom of the pages linked to, thereby providing _bi-directional linking_.
* SilverBullet is a **web application** and therefore accessible from wherever a (modern) web browser is available.
* SilverBullet is built as a [[Local First]] [[PWA]] keeping a copy of your content in your browser’s local ([IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)) database, syncing back to the server when a network connection is available.
* SilverBullet is a **self-hosted** solution: _you own your data_. Your [[Spaces|space]] is stored as plain files in a folder on disk on your server. Back it up, sync, edit, publish, script it with any additional tools you like.
* SilverBullet is optimized for **keyboard-based operation**:
  * Quickly navigate between pages using the **page switcher** (triggered with `Cmd-k` on Mac or `Ctrl-k` on Linux and Windows).
  * Run commands via their keyboard shortcuts or the **command palette** (triggered with `Cmd-/` or `Ctrl-/` on Linux and Windows).
  * Use [[Slash Commands]] to perform common text editing operations.
* SilverBullet is a platform for [[End-User Programming]] through its support for [[Objects]] and [[Space Lua]].
* SilverBullet can be extended using [[Space Lua]] and [[Plugs]], and a lot of core functionality is built that way.
* SilverBullet is free, [**open source**, MIT licensed](https://github.com/silverbulletmd/silverbullet) software.

# Project status
SilverBullet has been in development since late 2022, but is ever evolving. The current iteration is **SilverBullet v2**. We had a little bit of a reboot, rebuilding some of the foundations, and replacing some of the previous ([v1](https://v1.silverbullet.md)) features. 

# What’s next?
* [[Manual]]: SilverBullet’s official, yet incomplete manual.
* [[CHANGELOG]]: we’re in active development, so things change rapidly. Watch this page to keep up.
* [Community](https://community.silverbullet.md): join our community: ask questions, share your experiences.
* [Issues](https://github.com/silverbulletmd/silverbullet/issues): if you have ideas or find bugs, please report them.
* [Mastodon](https://fosstodon.org/@silverbulletmd): follow SilverBullet development on [Mastodon](https://joinmastodon.org/).
