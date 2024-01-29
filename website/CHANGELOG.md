An attempt at documenting the changes/new features introduced in each
release.

---

## Edge
$edge

_The changes below are not yet released “properly.” To try them out early, check out [the docs on edge](https://community.silverbullet.md/t/living-on-the-edge-builds/27)._

* No edgy updates since 0.6.1. Hang tight!

## 0.6.1
* Tag pages: when you click on a #tag you will now be directed to a page that shows all pages, tasks, items and paragraphs tagged with that tag.
* Action buttons (top right buttons) can now be configured; see [[SETTINGS]] for how to do this.
* Headers are now indexed, meaning you can query them [[Objects#header]] and also reference them by name via page links using `#` that I just demonstrated 👈. See [[Links]] for more information on all the types of link formats that SilverBullet now supports.
* New {[Task: Remove Completed]} command to remove all completed tasks from a page
* **Read-only mode** (experimental) is here; see [[Install/Configuration#Run mode]] on how to enable it. This allows you expose your space to the outside world in all its glory but without allowing anybody to edit anything.
  * [silverbullet.md](https://silverbullet.md) has now been redeployed to run in this mode
  * Pages in this mode are _server-side rendered_ so their content can actually be indexed by search engines. In addition, some [OpenGraph](https://ogp.me/) attributes are put in in the HTML to enable nice embedding links, e.g. in our [community](https://community.silverbullet.md).
* New {[Clear Local Storage & Logout]} command to wipe out any locally synced data (and log you out if you use [[Authentication]]).
* Bug fixes:
  * Improved Ctrl/Cmd-click (to open links in a new window) behavior: now actually follow `@pos` and `$anchor` links.
  * Right-clicking links now opens the browser's native context menu again
  * `tags` in [[Frontmatter]] are now properly indexed again when listed as an array
* Internal changes:
  * Big refactor: of navigation and browser history, fixed some {[Page: Rename]} bugs along the way
  * Plugs now can no longer define their own markdown syntax, migrated all plug-specific syntax into the main parser. This should remove a bunch of editor “flashing” especially during sync.

---

## 0.6.0

* **Templates 2.0**: templates are now turbocharged (that’s a technical term) and have replaced a lot of previously built-in (slash) commands. There’s more to this than will fit this CHANGELOG, have a look at [[Templates]]: and more specifically [[Page Templates]], [[Snippets]], [[Live Template Widgets]] and [[Libraries]], and read the items below.
* **Upgrade instructions**: to get the best experience after upgrading to 0.6.0 as an existing user, do the following:
  * Upgrade your docker image/deno version to 0.6.0 (or `latest`).
  * Reload your page 2-3x to be sure you have the latest front-end code running.
  * Run the {[Library: Import]} command in your space, and enter the following federation URL: `!silverbullet.md/Library/` This will import both the [[Library/Core]] and [[Library/Journal]] libraries into your space, bringing you roughly on par with 0.5.x versions in terms of functionality (this will include the daily note, weekly note, various slash commands etc.)
* A **quick FAQ** on the new template system:
  * **Where did my templates go!?** They have now moved to the [[Template Picker]], run {[Navigate: Page Picker]} (or press `Cmd-Shift-t` on Mac or `Ctrl-Shift-t` on Windows/Linux) to get to them.
  * **Where did all my slash commands go?!** They are now distributed via [[Libraries]]. Yep, Libraries are here, enabling an easier way to distribute templates and pages. Read [[Libraries]] for more info.
  * **But, what about slash templates etc.?!** Yeah, we did some rebranding and changed how these are defined. Slash templates are now [[Snippets]] and cannot _just_ be instantiated via [[Slash Commands]], but through [[Commands]] and custom keybindings as well. Awesomeness.
  * **And my page templates broke!?** Yeah, same story as with [[Snippets]]: the format for defining these changed a bit, but should be easy to update to the new format: check [[Page Templates]].
* The [[Getting Started]] page (that is embedded in the `index` page that is auto-generated when creating a new space) has been updated to include instructions on how to import the [[Library/Core]] library.
* **Directives have now been removed** from the code base. Please use [[Live Queries]] and [[Live Templates]] instead. If you haven’t migrated yet and want to auto-migrate, downgrade your SilverBullet version to 0.5.11 (e.g. using the `zefhemel/silverbullet:0.5.11` docker image) and run the {[Directive: Convert Entire Space to Live/Templates]} command with that version.
* (Hopefully subtle) **breaking change** in how tags work (see [[Objects]]):
  * Every object now has a `tag` attribute, signifying the “main” tag for that object (e.g. `page`, `item`)
  * The `tags` attribute will now _only_ contain explicitly assigned tags (so not the built-in tag, which moved to `tag`)
  * The new `itags` attribute (available in many objects) includes both the `tag` and `tags` as well as any tags inherited from the page the object appears in.
  * Page tags now no longer need to appear at the top of the page, but can appear anywhere as long as they are the only thing appearing in a paragraph with no additional text; see [[Objects#page]].
* New [[Markdown/Code Widgets|Code Widget]]: `toc` to manually include a [[Table of Contents]]
* Filter list (used by [[Page Picker]], [[Template Picker]] and [[Command Palette]]) improvements:
  * Better ranking
  * Better positioning of modal (especially on mobile)
  * Better mouse behavior
* Templates:
  * Somewhat nicer rendering of {{templateVars}} (notice the gray background)
  * Rendering of [[Markdown/Code Widgets]] (such as live queries and templates) **is now disabled** on template pages, which should make them less confusing to read and interpret.
* The `indexPage` [[SETTINGS]] can now contain template variables, such as `{{today}}`
* Backend work in preparation for supporting more “serverless” deployments (e.g. Cloudflare workers and Deno Deploy) in the future
  * Move from [Oak](https://oakserver.github.io/oak/) to [Hono](https://hono.dev/)
  * Support for in-process plug loading (without workers)

---

## 0.5.11
* Keyboard shortcuts as well as priority (order in which they appear in the [[Command Palette]]) can now be configured for [[Commands]] in [[SETTINGS]]. The `priority` enables you to put frequently used commands at the top.
* The rendering of [[Live Templates]], [[Live Queries]], [[Table of Contents]] and [[Linked Mentions]] has been re-implemented. Rendering should now be near-instant, and the “flappy” behavior should be largely gone, especially after an initial load (results are cached). There may still be some visual regressions. Please report them if you find them.

---

## 0.5.10
* **Breaking change**: Local attachment URLs (`[page](url)` syntax and `![alt](url)` image syntax) are now interpreted relative to the page's folder unless their URL starts with a `/`, then they're relative to the space root (as per [this issue](https://github.com/silverbulletmd/silverbullet/issues/363))
* **Breaking change:** Revamped [[Templates]], specifically changed the format of [[Page Templates]]. The “Template: Instantiate Page” has been renamed to {[Page: From Template]}.
* It is now even more recommended to tag your [[Templates]] with the “template” tag because completion in [[Live Queries]] and [[Live Templates]] will now only suggest `#template` tagged pages.
* New [[Frontmatter]] attributes with special meaning: `displayName` and `aliases` (allowing to specify alternative names for pages)
* The [[Page Picker]] now also shows (and matches against) tags, aliases and display names for pages.
* It is now possible to filter pages based on tags in the [[Page Picker]] by typing a hashtag in the filter phrase, e.g. `#template` to filter pages that have a `template` tag.
* Added new commands to manage [[Outlines]]. Note this resulted in changing names and keyboard shortcuts for managing folds as well, to be more consistent with the other outline commands.
* Removed built-in multi-user [[Authentication]], `SB_AUTH` is no longer supported; use `--user` or `SB_USER` instead or an authentication layer such as [[Authelia]].
* Background and more experimental work:
  * Work on supporting multiple database and storage backends, reviving [[Install/Deno Deploy]] support.
  * This is now documented on the brand-new [[Install/Configuration]] page.
  * A new `silverbullet sync` command to [[Sync]] spaces (early days, use with caution)
  * Technical refactoring in preparation for multi-tenant deployment support (allowing you to run a single SB instance and serve multiple spaces and users at the same time)
    * Lazy everything: plugs are now lazily loaded (after a first load,  manifests are cached). On the server side, a whole lot of infrastructure is now only booted once the first HTTP request comes in

---

## 0.5.8
* Various bugfixes, primarily related to the new way of running docker containers, which broke things for some people. Be sure to have a look at the new [[Install/Configuration]] configuration options

---

## 0.5.7
* New {[Upload: File]} command to upload files and pictures (particularly valuable for mobile use cases). Implemented by [prcrst](https://github.com/silverbulletmd/silverbullet/pull/571).
* General support for highlighting errors (underlined) in the editor. Currently implemented for:
  * All YAML fenced code blocks (and [[Frontmatter]]): will now highlight YAML parse errors
  * [[Live Queries]]: will highlight non-existing query sources and non-existing template references in `render` clauses
* Basic [[Table of Contents]] support: any page _with 3 headers or more_ now has a “Table of Contents” widget appear (see this very page). You can toggle this feature using the {[Table of Contents: Toggle]} command.
* Tapping/clicking the top bar (outside of the page name and action buttons) now scrolls your page to the very top.
* Slightly more gracious error reporting on load when using the Online [[Client Modes]] and the server is offline.
* Any page tagged with `#template` is no longer indexed (besides as a `template`)
* Upgraded set of emoji (completed via the :thinking_face: syntax) to 15.1 (so more emoji)
* Various bug fixes

---
## 0.5.6
* Various optimization and bug fixes
* Experimental idea: [[Libraries]]
* The `Alt-Shift-n` key was previously bound to both {[Page: New]} and {[Quick Note]}. That won’t work, so now it’s just bound to {[Quick Note]}
* The `Alt-q` command is now bound to the new {[Live Queries and Templates: Refresh All]} command, refreshing all [[Live Queries]] and [[Live Templates]] on the page. This is to get y’all prepared to move away from directives.
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
  * New feature: Introducing [[Snippets]], allowing you to create custom [[Slash Commands]]. This deprecates snippets and page templates, because [[Snippets]] are awesomer. 
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
  * Paragraphs are now indexed, see [[Objects#paragraph]] (thanks to [Ian Shehadeh](https://github.com/silverbulletmd/silverbullet/pull/528))
  * For consistency, list items are now always indexed as well (whether they contain a [[Tags|tag]] or not) see [[Objects#item]].
* The {[Directive: Convert to Live Query/Template]} now also converts `#use` and `#include` directives
* Styling improvements for Linked Mentions
* SilverBullet now fully works when added as PWA on Safari 17 (via the “Add to Dock” option).
* Fix support for handlebars variables in [[Live Queries]] and [[Live Templates]]
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

* [[Objects]]: a more generic system for indexing and querying content in your space, including the ability to define your own custom object “types” (dubbed [[Tags]]). See the referenced pages for examples.
* [[Live Queries]] and [[Live Templates]]: ultimately will replace directives in future versions and **directives are now deprecated.** They differ from directives in that they don’t materialize their output into the page itself, but rather render them on the fly so only the query/template instantiation is kept on disk. All previous directive examples on this website how now been replaced with [[Live Templates]] and [[Live Queries]]. To ease the conversion there is {[Directive: Convert Query to Live Query]} command: just put your cursor inside of an existing (query) directive and run it to auto-convert.
* The query syntax used in [[Live Queries]] (but also used in directives) has been significantly expanded, although there may still be bugs. There’s still more value to be unlocked here in future releases.
* The previous “backlinks” plug is now built into SilverBullet as [[Linked Mentions]] and appears at the bottom of every page (if there are incoming links). You can toggle linked mentions via {[Mentions: Toggle]}.
* A whole bunch of [[PlugOS]] syscalls have been updated. I’ll do my best update known existing plugs, but if you built existing ones some things may have broken. Please report anything broken in [Github issues](https://github.com/silverbulletmd/silverbullet/issues).
* This release effectively already removes the `#eval` (it’s still there, but likely not working), this directive needs some rethinking. Join us on [Discord](https://discord.gg/EvXbFucTxn) if you have a use case for it and how you use/want to use it.

**Important**:
* If you have plugs such as “backlinks” or “graphview” installed, please remove them (or to be safe: all plugs) from the `_plug` folder in your space after the upgrade. Then, also remove them from your `PLUGS` page. The backlinks plug is now included by default (named [[Linked Mentions]]), and GraphView still needs to be updated (although it’s been kind of abandoned by the author).

Due to significant changes in how data is stored, likely your space will be resynced to all your clients once you upgrade. Just in case you may also want to {[Space: Reindex]} your space. If things are really broken, try the {[Debug: Reset Client]} command.

---

## 0.4.0
The big change in this release is that SilverBullet now supports two [[Client Modes|client modes]]: _online_ mode and _sync_ mode. Read more about them here: [[Client Modes]].

Other notable changes:
* Massive reshuffling of built-in [[Plugs]], splitting the old “core” plug into [[Plugs/Editor]], [[Plugs/Template]] and [[Plugs/Index]].
* Directives in [[Live Preview]] now always take up a single line height.
* [[Plugs/Tasks]] now support custom states (not just `[x]` and `[ ]`), for example:
  * [IN PROGRESS] An in progress task
  * [BLOCKED] A task that’s blocked
  [[Plugs/Tasks|Read more]]
* Removed [[Cloud Links]] support in favor of [[Federation]]. If you still have legacy cloud links, simply replace the 🌩️ with a `!` and things should work as before.

