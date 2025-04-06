> **warning** Warning
> You are looking at the documentation of SilverBullet **v2**, which is still a work in progress. If you like less _edgy_ stuff, you can have a look at [v1](https://v1.silverbullet.md/) instead. All active development happens here, on v2, though. Migrating? Check out the [[Migrate from v1]] docs.

# Introduction
SilverBullet is an open source **personal productivity platform** built on [[Markdown]], turbo charged with the scripting power of [[Space Lua|Lua]]. You [[Install|self host]] it on your server, access it via any modern browser on any device (desktop, laptop, mobile). Since SilverBullet is built as a [[Local First]] [[PWA]], it is fully offline capable. Temporarily don’t have network access? No problem, SilverBullet will sync your content when you get back online.

In case you were wondering: yes, you are looking at a (read-only) instance of SilverBullet right now. Switch off your Internet connection, and this website will still be available for your reading pleasure.

Let’s dig in.

# A Typical Journey
You may start your SilverBullet journey by simply thinking of it as a note taking app.

Because, well, it is.

You write notes in [[Markdown]] and get [[Live Preview]]. It looks WYSIWYG while still easily accessing the markdown that lies underneath. There are convenient keyboard shortcuts to make your text **bold** or _italic_. You can create [[Links]] to other pages, via the `[[other page]]` syntax. As you navigate your [[Spaces|Space]] (that’s what we call a SilverBullet instance) by clicking these links, you will see [[Linked Mentions]] to get a feel of how your pages are inter-linked.

That’s nice, but oh my. We’re just getting started.

Then you learn that in SilverBullet, you can embed [[Space Lua]] (SilverBullet’s [[Lua]] dialect) right into your pages, using the special `${lua expression}` syntax.

You try something simple, like ${10 + 2} (Alt-click to see the underlying code). You realize you’ll never have to use a calculator again.

Ok, that’s cool, but you are _serious people_. You have work to do. You were promised a productivity platform, so let’s get to it.

As exercise material, [[Person/Zef|here’s a page on SilverBullet’s author]] tagged as a `#person`, with some additional [[Frontmatter]] attached. As it turns out, pages (and other things) are indexed as [[Objects]].

Let’s see if we can query those as a type of database (again, Alt-click the table to see the underlying code):

${query[[
  from index.tag "person"
  select { firstName=firstName, lastName=lastName }
]]}

_Noice._

But let’s render this in a slightly more customized way:

${template.each(query[[from index.tag "person"]], template.new[==[
    * [[${ref}]]: **First name:** ${firstName}, **Last name:** ${lastName}, **Location:** ${location}
]==])}

So... your notes, become a type of... _database_?

Imagine the possibilities.

You may have been told there is _no such thing_ as a [silver bullet](https://en.wikipedia.org/wiki/Silver_bullet).

You were told wrong.

# Features
So, what is SilverBullet? Like, _really._

* SilverBullet at its core is a **note taking** application, a kind of personal wiki, storing its notes in the universal [[Markdown]] format in a folder on your server.
* SilverBullet provides an enjoyable [[Markdown]] writing experience with a clean UI, rendering text using [[Live Preview|live preview]], further **reducing visual noise** while still providing direct access to the underlying markdown syntax.
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

# Install SilverBullet
Convinced to install this yourself? Please proceed to [[Install]], and enjoy!

# Project status
SilverBullet has been in development since late 2022, but is ever evolving. The current iteration is **SilverBullet v2**. We had a little bit of a reboot, rebuilding some of the foundations, and replacing some of the previous ([v1](https://v1.silverbullet.md)) features. 

# What next?
* [[Manual]]: SilverBullet’s official, yet incomplete manual.
* [[CHANGELOG]]: we’re in active development, so things change rapidly. Watch this page to keep up.
* [Community](https://community.silverbullet.md): join our community: ask questions, share your experiences.
* [Issues](https://github.com/silverbulletmd/silverbullet/issues): if you have ideas or find bugs, please report them.
* [Mastodon](https://fosstodon.org/@silverbulletmd): follow SilverBullet development on [Mastodon](https://joinmastodon.org/).
