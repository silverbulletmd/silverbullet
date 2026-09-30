#desktop

A Meta Space is one of your [[Local Space|local spaces]] that SilverBullet Desktop underlays into all the others, so its configuration, libraries and templates are available everywhere.

SilverBullet Desktop supports unlimited spaces. That's great for keeping contexts separate. The downside: anything you want available _everywhere_ — a shared snippet of `CONFIG.md`, a [[Space Lua]] library you wrote once and want to reuse — has to be copied into every space, and kept in sync. Not great.

The **Meta Space** is the way out. It's a SilverBullet+ feature available with [Desktop Pro](https://silverbullet.md/pricing) that lets you nominate one of your spaces as a shared underlay for all the others. Anything you put in your meta space (config, libraries, custom commands, templates) automatically becomes available in every other space. The dashboard currently labels it a beta feature.

# How it works
Conceptually, every space in SilverBullet is a stack of layers. At the top is your folder on disk, which you can read and write freely. Underneath sits a bundle of built-in libraries and plugs that implement a lot of SilverBullet core functionality. The meta space slots in between: your own folder on top, your meta space's files in the middle, the built-ins underneath.

When you open a space that has the meta space underlaid:

* Files in your meta space show up in the file list just like your own pages.
* They are **read-only** — to edit them you switch to the meta space itself, where they behave like normal pages.
* If a file in your own space has the same name as a meta-space file, your own version wins. The meta space is a fallback, not an override.

# CONFIG.md and METACONFIG.md
The meta space contains an ordinary `CONFIG` page and any other page. When the meta space is underlaid into another space, the space files are merged (where the meta space's `CONFIG` page is renamed to `METACONFIG` to avoid clashes with local `CONFIG` changes). Since SilverBullet will load `space-lua` from anywhere in the space, both will be activated.

# Setting it up
1. Create a new space, for example one called `META`.
2. Open it and set it up like any other space: tweak your configuration via the [[Configuration Manager]] or by editing a `CONFIG.md` manually. Install libraries as you see fit as well.
3. Open the SilverBullet Desktop dashboard and go to the **Pro** tab.
4. Under **Meta space**, pick `META` from the dropdown.

All _other_ spaces will now load the meta space as well (you may have to reopen some windows). In each you will see a `METACONFIG.md` and library files appear in the file list.

To switch which space is your meta space, just pick a different one from the dropdown. To turn the feature off, pick `<None>`.

# Notes
Editing your meta space takes effect live: changes to its `CONFIG.md` or library pages are picked up by your other spaces the next time you `System: Reload`, the same way any local file change is detected.

See also [[Licensing]].
