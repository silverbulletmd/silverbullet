An attempt at documenting the changes/new features introduced in each
release.

---

## 0.5.7
* New {[Upload: File]} command to upload files and pictures (particularly valuable for mobile use cases). Implemented by [prcrst](https://github.com/silverbulletmd/silverbullet/pull/571).
* General support for highlighting errors (underlined) in the editor. Currently implemented for:
  * All YAML fenced code blocks (and [[Frontmatter]]): will now highlight YAML parse errors
  * [[Live Queries]]: will highlight non-existing query sources and non-existing template references in `render` clauses
* Basic [[Table of Contents]] support: any page _with 3 headers or more_, now has a “Table of Contents” widget appear (see this very page). You can toggle this feature using the {[Table of Contents: Toggle]} command.
* Tapping/clicking the top bar (outside of the page name and action buttons) now scrolls your page to the very top.
* Slightly more gracious error reporting on load, when using the Online [[Client Modes]] and the server is offline.
* Any page tagged with `#template` is no longer indexed (beside as a `template`)
* Upgraded set of emoji (completed via the :thinking_face: syntax) to 15.1 (so more emoji)
* Various bug fixes

---
## 0.5.6
* Various optimization and bug fixes
* Experimental idea: [[Template Sets]]
* The `Alt-Shift-n` key was previously bound to both {[Page: New]} and {[Quick Note]}. That won’t work, so now it’s just bound to {[Quick Note]}
* The `Alt-q` command is now bound to the new {[Live Queries and Templates: Refresh All]} command refreshing all [[Live Queries]] and [[Live Templates]] on the page. This is to get y’all prepared to move away from directives.
* It’s likely that version 0.6.0 **will remove directives**, so please switch over to live queries and templates, e.g. using...
  * The new {[Directive: Convert Entire Space to Live/Templates]} command, which will (attempt) to convert all uses of directives in your space automatically (backup your space before, though, just in case)


---
## 0.5.5
* Bugfix: on some filesystems that don't report file creation time (like some NASes), SilverBullet crash. This should now be fixed.
* Performance improvements the loading of code widgets (e.g. Live Queries, Live Templates)

---
## 0.5.4
* We’re on a journey to rethink [[Templates]]:
  * It is now _recommended_ you tag all your templates with a `#template` tag, this will exclude them from [[Objects]] indexing and may in the future be used to do better template name completion (but not yet).
  * New feature: Introducing [[Slash Templates]], allowing you to create custom [[Slash Commands]]. This deprecates snippets and page templates, because [[Slash Templates]] are awesomer. 
* Many styling fixes and improvements to [[Live Queries]] and [[Live Templates]]
* Added a “source” button to [[Live Queries]] and [[Live Templates]] for better debugging (showing you the markdown code rendered by the template so you can more easily detect issues)
* [[Live Queries]]:
  * Support for `render all` where the entire result set is passed to a single template allowing you to e.g. dynamically build up tables, see [[Live Queries$render]] for an example.
* The default generated [[SETTINGS]] page now contains a link to [[SETTINGS]] on silverbullet.md for documentation purposes.
* The syntax to reference [[Anchors]] has now changed to use `$`, instead of `@` (e.g. [[Live Queries$render]]), the old syntax still works but is deprecated. The reason for this change is consistency: you define an anchor using the `$myanchor` syntax, referencing it the same way makes more sense.
* [[Page Name Rules]] are now documented

---
## 0.5.3
* Changes to [[Objects]]:
  * Paragraphs are now indexed, see [[Objects@paragraph]] (thanks to [Ian Shehadeh](https://github.com/silverbulletmd/silverbullet/pull/528))
  * For consistency, list items are now always indexed as well (whether they contain a [[Tags|tag]] or not) see [[Objects@item]].
* The {[Directive: Convert to Live Query/Template]} now also converts `#use` and `#include` directives
* Styling improvements for Linked Mentions
* SilverBullet now fully works when added as PWA on Safari 17 (via the “Add to Dock” option).
* Fix support for handlebars variables in [[Live Queries]] and [[live]]
* Plug robustness improvements (SB shouldn’t fully break when loading plugs that rely on disabled syscalls)
* Various other bug fixes

---

## 0.5.1
* Fixes to auto-sizing of [[Live Queries]] and [[Live Templates]] widgets
* Fixed the combination of `limit` and `order by` not working well
* Auto complete for queries now works for queries split across multiple lines
* Auto complete for fenced code block languages (use the `/code` slash command)
* Slightly tweaked semantics for the `=` operator on arrays, see [[Live Queries]] for details

---

## 0.5.0
Oh boy, this is a big one. This release brings you the following:

* [[Objects]]: a more generic system to indexing and querying content in your space, including the ability to define your own custom object “types” (dubbed [[Tags]]). See the referenced pages for examples.
* [[Live Queries]] and [[Live Templates]]: ultimately will replace [[🔌 Directive]] in future versions and **[[🔌 Directive]] is now deprecated.** They differ from directives in that they don’t materialize their output into the page itself, but rather render them on the fly so only the query/template instantiation is kept on disk. All previous directive examples on this website how now been replaced with [[Live Templates]] and [[Live Queries]]. To ease the conversion there is {[Directive: Convert Query to Live Query]} command: just put your cursor inside of an existing (query) directive and run it to auto-convert.
* The query syntax used in [[Live Queries]] (but also used in [[🔌 Directive]]) has been significantly expanded, although there may still be bugs. There’s still more value to be unlocked here in future releases.
* The previous “backlinks” plug is now built into SilverBullet as [[Linked Mentions]] and appears at the bottom of every page (if there are incoming links). You can toggle linked mentions via {[Mentions: Toggle]}.
* A whole bunch of [[PlugOS]] syscalls have been updated, I’ll do my best update known existing plugs, but if you built existing ones some things may have broken. Please report anything broken in [Github issues](https://github.com/silverbulletmd/silverbullet/issues).
* This release effectively already removes the `#eval` [[🔌 Directive]] (it’s still there, but likely not working), this directive needs some rethinking. Join us on [Discord](https://discord.gg/EvXbFucTxn) if you have a use case for it and how you use/want to use it.

**Important**:
* If you have plugs such as “backlinks” or “graphview” installed, please remove them (or to be safe: all plugs) from the `_plug` folder in your space after the upgrade. Then, also remove them from your [[PLUGS]] page. The backlinks plug is now included by default (named [[Linked Mentions]]), and GraphView still needs to be updated (although it’s been kind of abandoned by the author).

Due to significant changes in how data is stored, likely your space will be resynced to all your clients once you upgrade. Just in case you may also want to {[Space: Reindex]} your space. If things are really broken, try the {[Debug: Reset Client]} command.

---

## 0.4.0
The big change in this release is that SilverBullet now supports two [[Client Modes|client modes]]: _online_ mode and _sync_ mode. Read more about them here: [[Client Modes]].

Other notable changes:
* Massive reshuffling of built-in [[🔌 Plugs]], splitting the old “core” plug into [[🔌 Editor]], [[🔌 Template]] and [[🔌 Index]].
* Directives in [[Live Preview]] now always take up a single line height.
* [[🔌 Tasks]] now support custom states (not just `[x]` and `[ ]`), for example:
  * [IN PROGRESS] An in progress task
  * [BLOCKED] A task that’s blocked
  [[🔌 Tasks|Read more]]
* Removed [[Cloud Links]] support in favor of [[Federation]]. If you still have legacy cloud links, simply replace the 🌩️ with a `!` and things should work as before.

