An attempt at documenting the changes/new features introduced in each
release.

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

---

## 0.3.11

* Cookies set when using SilverBullet's built-in [[Authentication]] are now per domain + port, allowing you to run multiple instances of SB on a single host with different ports without the authentication interfering.
* Page references in [[SETTINGS]] now use double-bracket notation (optionally) which is nicer, because you’ll get completion. See [[SETTINGS]] for examples.
* It is now possible to override [[🔌 Plugs]] manifests. The primary use case for this is to be able to _override keyboard shortcuts_. This feature may still change over time, but you can try it out. See [[SETTINGS]] for an example.
* Fix `silverbullet upgrade` hanging
* Fixes to syntax coloring
* Various internal refactoring in preparation for cool things to come

---

## 0.3.10
* Sync improvements:
  * Now syncing the currently open page every 5s with the server
  * Now more instantly syncing indirectly updated pages, e.g. when checking off tasks in a query
  * Less aggressive "you're offline" signaling (now only showing yellow bar after 2 failed sync attempts)
* New `/page-template` slash command to apply (insert) a page [[🔌 Core/Templates|template]] at the current location
* When the PWA starts, it will now send you back to the last opened page instead of the index page (you may have to reinstall the PWA for this change to take effect).
* [[Markdown/Syntax Highlighting]] for HTML
* Various heavy-weight commands (such as {[Space: Reindex]} and {[Directives: Update Entire Space]}) now use an internal message queue, allowing to continue the processing even when interrupted or crashing.
* Various internal refactorings

---

## 0.3.9
* [[Metadata]] both in [[Frontmatter]] and [[Attributes]] names are now indexed (scoped to whether they apply to pages, items or tasks) and code completed, e.g in front matter, attribute syntax and queries.
* When pressing `Shift-Enter` rather than regular `Enter` in the page navigator, the input is now used literally to create a new page with that name. For example, typing in “my page” and hitting `Shift-Enter` will always create a page with that name (rather than defaulting to the best match, which is what `Enter` would navigate to).
* Fixes an issue where the focus would be taken away from a modal if the page needed to be reloaded in the background.
* Command to update directives across the entire space (not just the current page): {[Directives: Update Entire Space]}
* Ability to run plug functions from the CLI with `silverbullet plug:run`. For instance, to update all directives in an entire space, run:
  ```bash
  silverbullet plug:run /space-path directive.updateDirectivesInSpace
  ```

---

## 0.3.7
* **Important bug fix:** under specific circumstances an initial sync (of a new device) could result in the initial page (when opening SB) being deleted. Not good. Please upgrade to this version ASAP. And continue making backups of your space.
* New {[Refactor: Batch Rename Page Prefix]} command to rename a page prefix to something else, can be used to achieve the effect of renaming a folder (e.g. from `topics/` to `my topics/`) while updating all links properly.
* Update to [[Attributes]] syntax
* Fix: Renaming a template page now also updates references to it (e.g. in `render` clauses)
* Scroll position is now retained when switching between pages
* Various other fixes

---

## 0.3.6
* [Mobile view improvements](https://github.com/silverbulletmd/silverbullet/pull/452) for tables and directives (vertical spacing) by [vuau](https://github.com/vuau)
* Internal work on [color theming](https://github.com/silverbulletmd/silverbullet/pull/455) by [TheLD6978](https://github.com/TheLD6978)
* Re-implemented fuzzy search in the page picker, command palette etc. with [Fuse.js](https://www.fusejs.io/) — let’s see if people like this better.
* Backlinks (as queried via the `link` data source) now contains richer data, namely `inDirective` (if the link appears in the context of a directive) and `alias` (if the backlink has an alias name). This also fixes not updating page references inside directives. This introduced a backwards incompatible data. To update your indexes, please run {[Space: Reindex]} on your clients (once).
* Initial work on [[Attributes]] (inline [[Metadata]]) such as this [importance:: high]
* Added {[Debug: Reset Client]} command that flushes the local databases and caches (and service worker) for debugging purposes.
* Added {[Editor: Center Cursor]} command.
* New template helper `replaceRegexp`, see [[🔌 Template@vars]]
* **Bug fix**: Renaming of pages now works again on iOS
* Big internal code refactor

---

## 0.3.5
* **Removal of all real-time collaboration features**: this was causing too many edge cases, and complicated the code too much. To simplify the product as well as the code, we completely removed all real-time collaboration features for now. We may introduce this at some point in the future when the demand and focus is there.
* **Change of APIs**: This is mostly internal, but will likely have effects on the first load after the upgrade: you may see errors or a message around “the path has changed”, or your page may not properly load. Don’t freak out, just reload once or twice and all should resync and be fine. There’s a beginning of documenting the server [[API]] now.
* Better [[Authelia]] support
* When drag & dropping (or copy & pasting) a file onto a page now, the location will default to the same folder the page is in.
* Various bug fixes

---

## 0.3.4

* **Breaking change (for some templates):** Template in various places allowed you to use `{{variables}}` and various handlebars functions. There also used to be a magic `{{page}}` variable that you could use in various places, but not everywhere. This has now been unified. And the magical `{{page}}` now has been replaced with the global `@page` which does not just expose the page’s name, but any page meta data. More information here: [[🔌 Template@vars]]. You will now get completion for built-in handlebars helpers after typing `{{`.
* **Breaking change** (for [[STYLES]] users). The [[STYLES]] page is now no longer “magic” and hardcoded. It can (and must) now be specified in [[SETTINGS]] (see example on that page) for styles to be loaded from it.
* Folding is here (at least with commands, not much UI): {[Fold: Fold]}, {[Fold: Unfold]}, {[Fold: Toggle Fold]}, {[Fold: Fold All]} and {[Fold: Unfold All]}.
* {[Broken Links: Show]} command (not complete yet, but already useful)
* The `Daily Note` template now supports setting a caret position with `|^|`.
* Explicit {[Sync: Now]} command, for those who are impatient
* Tons of smaller bug fixes
* (Experimental) work towards a single-binary distribution of SilverBullet (per platform), no Deno install required.

---

## 0.3.2

* REMOVED:  **Real-time collaboration support** between clients: Open the same page in multiple windows (browser tabs, mobile devices) and within a few seconds you should get kicked into real-time collaboration mode, showing other participants cursors, selections and edits in real time (Google doc style). This only works when a connection with the server can be established.
* [[Authentication|Multi-user authentication]]: you can now allow multiple user accounts authenticate, which makes the real-time collaboration support actually useful. This feature is still experimental and will likely evolve over time.
* Added `spaceIgnore` setting to not sync specific folders or file patterns to the client, see [[SETTINGS]] for documentation
* Much improved image loading behavior on page (previously scroll bars would jump up and down like a mad person)
* Various bug fixes and quality of life improvements

---

## 0.3.1
This is a big one.

This is another big architectural shift warranting a major minor version bump 😉.

A detailed description of what happened [can be found in this PR](https://github.com/silverbulletmd/silverbullet/pull/403), the TL;DR is this:

* SilverBullet in this version is going **_all in_ on being an offline-capable [PWA](https://web.dev/progressive-web-apps/)**. This means the desktop and mobile applications will no longer be maintained. However, the value those applications brought (offline capability) has now been built right into the “regular web” version without the burden of having to maintain a desktop app for three platforms, and a mobile app for two.
* Upon first launch in a modern browser, SilverBullet will now _sync a full copy of your entire space locally_ (into your browser’s IndexedDB database). When a network connection to the server is available, it will sync files with it. On the server, files are still kept as regular files, nothing changes here.
  * To avoid accidentally syncing ginormous (that’s a technical term) files to your browser, by default files > 20MB are not exposed. This puts an effective **file size limit of 20MB on files** in your space, this limit is configurable with the `--maxFileSize` flag (file a file size in MB) when running `silverbullet`.
* After the first launch, you can disconnect from your network and your application should still be available: reload the page; restart the browser; reboot your machine, and everything still works. Note that while you’re offline, your title bar will appear in yellow to indicate this “offline” state.
* All processing (all [[🔌 Plugs]] logic) is now running in the browser. Previously, some of this work was offloaded to the server. No more, the server is now a dumb file store. You can (and probably should) delete your `data.db` file, which was previously used to store state on the server side.
* From a UI perspective little changes, except for a few things related to sync:
  * While SB is in an out-of-sync state, the title bar will appear yellow. This will also happen when it cannot reach the server. SB is still fully functional in this state. Once the connection is restored, all changes while offline are synced back to the server.
  * Upon initial load, a full sync will take place, which — depending on the size of your space — may take some time. Or even blow up completely, if you have a big amount of data there.
* To reset your browser state (flush out your entire space, caches and data stores) visit the `/.client/logout.html` page, e.g. at http://localhost:3000/.client/logout.html and push the button. Note that any unsynced changes will be wiped.

Besides these architectural changes, a few other breaking changes were made to seize the moment:
* **In plugs**:
  * Plugs are now distributed as `.plug.js` files instead of `.plug.json` files. This greatly improves debugability (when you compile with `--debug` you get source maps, and can even set breakpoints) and drastically decreases their file size. All existing plugs need to be recompiled using the `silverbullet plug:compile` command, and the resulting `.plug.js` file commited. Then update your [[PLUGS]] page to point to the resulting `.plug.js` files.
* **Breaking change** in URLs (if you bookmarked them before): spaces in page names used to be replaced with `_` to look nicer, however, this was causing too many issues for people, so they’re no longer replaced and will appear as `%20` (regular URI encoding) now.
* On mobile, you can now tap with two fingers on the editor to open the page picker, and with three fingers to open the command palette.
* Internal note: to avoid page/file name clashes in URLs, various internal URLs have changed, FS requests are now served from `/.fs` instead of `/fs`, and all client static files from `/.client` (was root before).

---

## 0.2.14

* Added `Cmd-.` (Mac) and `Ctrl-.` (Linux/Windows) as an additional keyboard shortcut (to `Cmd-/`, `Ctrl-/`) for launching the command palette.
* Improvements to dark mode by [Max Richter](https://github.com/silverbulletmd/silverbullet/pull/396)

---

## 0.2.13

* Support for multiple `order by` clauses in [[Live Queries]] by [Siddhant Sanyam](https://github.com/silverbulletmd/silverbullet/pull/387)
* Tags included in `tags` [[Frontmatter]] now included in hash tag auto complete
* Regression fix: when instantiating a page from a template it would always claim the page already existed (even if it didn't)

---

## 0.2.12

* Added support to override CSS styles on a per-space basis. This replaces the previous `fontFamily` setting. See [[STYLES]] for hints on how to use this new experimental feature.
* Sync: Support to exclude prefixes (via [[SETTINGS]])
* Reverted behavior of using up/down arrow keys to move between the page title and page content (and rename based on it). This resulted in undesirable behavior too often. You can now rename a page by clicking/tapping on the title, changing the name and hitting Enter or clicking anywhere outside the page title to apply the rename.
* Documentation updates (on https://silverbullet.md):
  * [[Special Pages]]
  * [[SETTINGS]]
* Support template variables in a page template's `$name`
* Dependency upgrades
* Various bug fixes

---

## 0.2.11
* Regression fix: hashtag completion works again
* Mobile:
  * App crashing/white screen after being in the background for some time should now be fixed
* Sync improvements:
  * Immediately trigger sync on file when opened in the editor (so you always get the latest version)
  * Automatically perform a {[Plugs: Update]} after performing a {[Sync: Wipe Local Space and Sync]}
  * New {[Sync: Disable]} command to disable sync (remove config and snapshot)
* {[Plugs: Update]} no longer fails when there is no [[PLUGS]] file.
* Desktop: New “Help” menu with link to documentation (silverbullet.md website) and About box with version number.
* You now see a clear error message when querying an non-supported query source.

---
## 0.2.10
* Syntax highlighting for a bunch of new languages — see [[Markdown/Syntax Highlighting]]: PgSQL, Rust, CSS, Python, Protobuf, Shell, Swift, toml, XML, JSON, C, C++, Java, C#, Scala, Kotlin, ObjectiveC, ObjectiveC++ and Dart
* [[Vim]] support for VIMRC (see [[Vim]] documentation)
* Desktop: “Open Recent” menu to quickly reopen recently opened spaces.
* Sync bug fixes and better logging (in {[Show Logs]})

---
## 0.2.9
* Fixed copy & paste, drag & drop of attachments in the Desktop app
* Continuous Sync
* Support for embedding [[Markdown/Code Widgets]].
* ~~Ability to set the editor font via the `fontFamily` setting~~ in [[SETTINGS]] (restart the app/reload the page to make it go into effect). **Update**: now done via [[STYLES]]

---
## 0.2.8
* Sync should now be usable and is documented
* Windows and Mac Desktop apps now have proper icons (only Linux left)
* Mobile app for iOS in TestFlight
* New onboarding index page when you create a new space, pulling content from [[Getting Started]].
* Various bug fixes

---

## 0.2.7

* New {[Extract text to new page]} command
* Improvement to listify commands by [Tristan Sokol](https://github.com/silverbulletmd/silverbullet/pull/290)
* {[Extract text to new page]} command by [Tristan Sokol](https://github.com/silverbulletmd/silverbullet/pull/286)
* SQL syntax highlighting in fenced code blocks by [Martin Kraft](https://github.com/silverbulletmd/silverbullet/pull/292)
  ```sql
  select * from my_table;
  ```
* Merged code for experimental mobile app (iOS only for now)
* Experimental sync support, to be documented once it matures
* Various bug fixes

---

## 0.2.6

* Various bug fixes
* First version of experimental [Electron-based desktop app](https://github.com/silverbulletmd/silverbullet/releases) for Mac, Windows and Linux.

---

## 0.2.5
* Changed styling for [[Frontmatter]], fenced code blocks, and directives to avoid vertical jumping when moving the cursor around.
* Clicking the URL (inside of an image `![](url)` or link `[text](link)`) no longer navigates there, you need to click on the anchor text to navigate there now (this avoids a lot of weird behavior).
* Most areas where you enter text (e.g. the page name, page switcher, command palette and filter boxes) now use a CodeMirror editor. This means a few things:
  1. If you have vim mode enabled, this mode will also be enabled there.
  2. You can now use the emoji picker (`:party` etc.) in those places, in fact, any plug implementing the `minieditor:complete` event — right now just the emoji picker — will work.
* Added support for plugs to extend fenced code blocks with custom languages and rendering live-preview widgets for them. As a demo of this, have a look at markdown support (mostly for demo purposes):
```markdown
# Header
1. Item 1
2. Item 2
```
  Two more plugs are now available that add [[🔌 Mermaid]] and [[🔌 KaTeX]] (LaTeX formula) support using this functionality.
* To keep the UI clean, the dark mode button has been removed, and has been replaced with a command: {[Editor: Toggle Dark Mode]}.
* Added a command and short-cut for strike through (by [Evgenii Karagodin](https://github.com/silverbulletmd/silverbullet/pull/237))
* Bug fix: Long page names in titles now no longer overlap with action buttons.
* Moving focus out of the page title now always performs a rename (previously this only happened when hitting `Enter`).
* Clicking on a page reference in a `render` clause (inside of a directive) now navigates there (use Alt-click to just move the cursor)
* Moving up from the first line of the page will now move your cursor to the page title for you to rename it, and moving down from there puts you back in the document.
* Note for plug authors: The (misnamed) `page:complete` event has been renamed to `editor:complete`. There's also a new `minieditor:complete` that's only used for "mini editors" (e.g. in the page switcher, command palette, and page name editor).
* The `--user` authentication flag is now no longer powered by BasicAuth, but through a simple login form asking for a username and password and storing it in a cookie (that persists for 1 week). This gives the same level of security, but works around various browser bugs with basic auth.
* Fixed various styling issues.

---

## 0.2.4
* Vim mode is here! This mode can be enabled on a per-client basis (its state is stored in the browser). To toggle Vim mode on or off use the {[Editor: Toggle Vim Mode]} command.
* Security update: SB now binds to `127.0.0.1` by default, allowing just connections via `localhost`. To allow outside connections, pass the `--hostname 0.0.0.0` flag (and ideally combine it with a `--user username:password` flag to add basic authentication).

---

## 0.2.3

> **Note** Admonition support
> is now here

* Server changes:
  * Replaced the `--password` flag with `--user` taking a basic auth combination of username and password, e.g. `--user pete:1234`. Authentication now uses standard basic auth. This should fix attachments not working with password-protected setups.
  * Enable configuration of IP to bind to (via `--host` flag) by [Jouni K. Seppänen](https://github.com/silverbulletmd/silverbullet/pull/138)
* Markdown enhancements:
  * Added support for ~~strikethrough~~ syntax.
  * Added support for [admonitions](https://github.com/community/community/discussions/16925) using Github syntax (`note` and `warning`) by [Christian Schulze](https://github.com/silverbulletmd/silverbullet/pull/186)
* Directives have been heavily reworked, and are now "properly" parsed. This is visible in two ways:
  * There's now syntax highlighting for queries
  * Once the cursor is placed within a directive, it shows the whole block as a "capsule" enclosed in the opening and close tag, when the cursor is outside, it just subtly highlights what parts of a page are directive generated.
* New logo! Contributed by [Peter Coyne](https://github.com/silverbulletmd/silverbullet/pull/177)
* New button icons, from [feather](https://feathericons.com/) (suggested by Peter Coyne)
* UI font tweaks
* Fix for the {[Page: Rename]} command by [Chris Zarate](https://github.com/silverbulletmd/silverbullet/pull/190)
* Empty query result set rendered as a table now shows “No results” instead of an empty markdown table — fix by [ItzNesbro](https://github.com/silverbulletmd/silverbullet/pull/192).

---

## 0.2.2

* New page link aliasing syntax (Obsidian compatible) is here: `[[page link|alias]]` e.g. [[CHANGELOG|this is a link to this changelog]]. Also supported for command links: `{[Plugs: Add|add a plug]}`
* Less "floppy" behavior when clicking links (regular, wiki and command): just navigates there right away. Note: use `Alt-click` to move the cursor inside of a link.
* Page references to non-existing pages are now highlighted in a (red-ish) color
* Added `invokeFunction` `silverbullet` CLI sub-command to run arbitrary plug functions from the CLI.
* Restyled #tags
* When tasks are indexed, the hashtag is now no longer removed from the task text

---

## 0.2.1

* New `Plugs: Add` command to quickly add a new plug (will create a `PLUGS` page if you don't have one yet).
* **Paste without formatting**: holding `Shift` while pasting will disable "rich text paste."
* **New core plug:** [[🔌 Share]] for sharing your pages with the outside work (such as collab, see below).
* **New plug:** 🔌 Collab for real-time collaboration on your pages.

---

## 0.2.0
* The editor is now in "live preview" mode where a lot of markdown is hidden unless the cursor is present. This will take some getting used to, but results in a much more distraction free look.
* Clicking on the page name in the top bar now allows you to quickly rename pages, hit enter to apply the change.
* The previous behavior of opening the page switcher, has now moved to its own action button (the folder one)
* Page reference completion now orders results by last modified date (newer matches appear closer to the top)
* Changes to some slash commands:
  * `/task` now is smarter and attempts to turn your current line into a task
  * `/h1` through `/h4` will turn the current line into a header
* **Breaking change:** task and item tags are [now indexed without the prefixing `#`](https://github.com/silverbulletmd/silverbullet/issues/124), this means that any queries, such as `#query task where tags = "#mytag"` need to be rewritten to `#query task where tags = "mytag"`. This will go into effect after a space reindex.
---

## 0.1.5

* Rich text paste: paste content from web pages, google docs, including tables and SB will make a best effort to convert it to Markdown. Implemented using [turndown](https://github.com/mixmark-io/turndown). Probably can use some tweaking, but it's something.

---

## 0.1.4

* Breaking change (for those who used it): the named anchor syntax has changed from `@anchorname` to `$anchorname`. This is to avoid conflicts with potential future use of `@` for other purposes (like mentioning people). Linking to an anchor still uses the `[[page@anchorname]]` syntax. So, you create an anchor $likethis you can then reference it [[@likethis]].
* The `query` plug has been renamed to `directive` (because it supports many other features now) and significantly refactored. New docs: [[🔌 Directive]]
  * New directive `#eval` see [[🔌 Directive@eval]]
* New PlugOS feature: redirecting function calls. Instead of specifying a `path` for a function, you can now specify `redirect` pointing to another function name, either in the same plug using the `plugName.functionName` syntax.
* `Cmd-click` or `Ctrl-click` now opens page references in a new window. You can `Alt-click` to put your cursor at the target without navigation.
* New {[Open Weekly Note]} command (weeks start on Sunday by default, to allow for planning, but you can change this to Monday by setting the `weeklyNoteMonday` to `true` in [[SETTINGS]]). Like for {[Open Daily Note]} you can create a template in `template/page/Weekly Note`.
* The `Create page` option when navigating pages now always appears as the _second_ option. Let me know how you like it.
* New `Preview` using a custom markdown renderer offering a lot of extra flexibility (and a much smaller file size). New thing it does:
  * Render front matter in a table
  * Makes {[Command buttons]} clickable
  * Makes todo tasks toggleable
* Integrated the `silverbullet-publish` plug into core (to be better documented later).

---

## 0.1.3

* SilverBullet now runs on Windows!
* Frontmatter support! You can now use front matter in your markdown, to do this
  start your page with `---` and end it with `---`. This will now be the
  preferred way to define page metadata (although the old way will still work).
  The old `/meta` slash command has now been replaced with `/front-matter`.
* Tags are now indexed as page meta without the prefixing `#` character, the
  reason is to make this compatible with Obsidian. You can now attach tags to
  your page either by just using a `#tag` at the top level of your page, or by
  adding a `tags` attribute to your front matter.
* {[Search Space]} works again. You may have to {[Space: Reindex]} to get
  results. Search results now also show a snippet of the page, with the phrase
  highlighted.
* Faster page indexing.
* `silverbullet` now has sub-commands. It defaults to just running the server
  (when passed a path to a directory), but you can also run
  `silverbullet --help` to see the available commands. Commands currently
  available:
  * `silverbullet upgrade` to perform a self-upgrade
  * `silverbullet fix` to attempt to solve any issues with your space (deletes
    your `_plug` directory and `data.db` file)
  * `silverbullet plug:compile` replaces the old `plugos-bundle` command.
  * `silverbullet version` prints the current version

---

## 0.1.2

* Breaking plugs API change: `readPage`, `readAttachment`, `readFile` now return
  the read data object directly, without it being wrapped with a text object.
* A whole bunch of deprecated syscalls has been removed

---

## 0.1.0 First Deno release

* The entire repo has been migrated to [Deno](https://deno.land)
* This may temporarily break some things.
* If somehow you’re experiencing trouble, try the following:
  * Delete all files under `_plug` in your pages folder, e.g. with
    `rm -rf pages/_plug`.
  * Delete your `data.db`
* Changes:
  * `PLUGS` is no longer required
  * `PLUGS` no longer supports `builtin:` plug URLs, all builtins are
    automatically loaded and no longer should be listed.
* Plugs no longer should be built with node and npm, PRs will be issued to all
  existing plugs later to help with this transition.
* Know breakages:
  * Full-text search is not yet implemented (the SQLite used does not support it
    right now)
  * GitHub auth has not been ported (yet)
* Technical changes:
  * Server runs on Deno (and Oak instead of Express)
  * Client is now built with ESBuild
  * React has been replaced with Preact
  * Package management in Deno works based on http imports, so npm is no longer
    used.

---

## 0.0.35

* Big refactor of the internal Space API unifying attachment and page handling.
  This shouldn't affect (most) existing code and plugs (except some more exotic
  areas), but if stuff breaks, please report it.
* Technical change: Upgrades are now detected on the server side, and plugs
  re-loaded and pages indexed upon every upgrade.
* Various bug fixes (e.g. using HTML tags on a page before completely broke
  syntax highlighting)
* Exposed `fulltext.*` syscalls on the client

---

## 0.0.34

* Change to attachment handling: the `attachment/` prefix for links and images
  is no longer used, if you already had links to attachments in your notes, you
  will need to remove the `attachment/` prefix manually. Sorry about that.
* Improved styling for completion (especially slash commands)
* Completion for commands using the (undocumented) `{[Command Syntax]}` — yep,
  that exists.

---

## 0.0.33

* **Attachments**: you can now copy & paste, or drag & drop files (images, PDF,
  whatever you like) into a page and it will be uploaded and appropriately
  linked from your page. Attachment size is currently limited to 100mb. Changed full-text search page prefix from `@search/` to `🔍` for the {[Search
  Space]} command.
* `page`, `plug` and `attachment` are now _reserved page names_, you cannot name
  your pages these (you will get an error when explicitly navigating to them).

---

## 0.0.32

* **Inline image previews**: use the standard
  `![alt text](https://url.com/image.jpg)` notation and a preview of the image
  will appear automatically. Example:
  ![Inline image preview](https://user-images.githubusercontent.com/812886/186218876-6d8a4a71-af8b-4e9e-83eb-4ac89607a6b4.png)
* **Dark mode**. Toggle between the dark and light mode using a new button,
  top-right.
  ![Dark mode screenshot](https://user-images.githubusercontent.com/6335792/187000151-ba06ce55-ad27-494b-bfe9-6b19ef62145b.png)
* **Named anchors** and references, create an anchor with the new @anchor
  notation (anywhere on a page), then reference it locally via [[@anchor]] or
  cross page via [[CHANGELOG@anchor]].

---

## 0.0.31

* Update to the query language: the `render` clause now uses page reference
  syntax `[[page]]`. For example `render [[template/task]]` rather than
  `render "template/task"`. The old syntax still works, but is deprecated,
  completion for the old syntax has been removed.
* Updates to templates:
  * For the `Template: Instantiate Page` command, the page meta value `$name` is
    now used to configure the page name (was `name` before). Also if `$name` is
    the only page meta defined, it will remove the page meta entirely when
    instantiating.
  * You can now configure a daily note prefix with `dailyNotePrefix` in
    `SETTINGS` and create a template for your daily note under
    `template/page/Daily Note` (configurable via the `dailyNoteTemplate`
    setting).
  * You can now set a quick note prefix with `quickNotePrefix` in `SETTINGS`.
* Directives (e.g. `#query`, `#import`, `#use`) changes:
  * Renamed `#template` directive to `#use-verbose`
  * New `#use` directive will clean all the embedded queries and templates in
    its scope
  * All directives now use the page reference syntax `[[page name]]` instead of
    `"page name"`, this includes `#use` and `#use-verbose` as well as `#import`.
  * The `link` query provider now also returns the `pos` of a link (in addition
    to the `page`)
  * New `$disableDirectives` page metadata attribute can be used to disable
    directives processing in a page (useful for templates)
* Added a new `/hr` slash command to insert a horizontal rule (`---`) useful for
  mobile devices (where these are harder to type)

---

## 0.0.30

* Slash commands now only trigger after a non-word character to avoid "false
  positives" like "hello/world".
* Page auto complete now works with slashes in the name.
* Having a `SETTINGS` page is now mandatory. One is auto generated if none is
  present.
* Added an `indexPage` setting to set the index page for the space (which by
  default is `index`). When navigating to this page, the page name will
  "disappear" from the URL. That is, the index URL will simply be
  `http://localhost:3000/`.
  * This feature is now used in `website` and set to `SilverBullet` there. To
    also make the title look nicer when visiting https://silverbullet.md

---

## 0.0.29

* Added the `Link: Unfurl` command, which is scoped to only work (and be
  visible) when used on “naked URLs”, that is: URLs not embedded in a link or
  other place, such as this one: https://silverbullet.md
  * Plugs can implement their own unfurlers by responding to the
    `unfurl:options` event (see the
    [Twitter plug](https://github.com/silverbulletmd/silverbullet-twitter) for
    an example).
  * Core implements only one unfurl option: “Extract title” which pulls the
    `<title>` tag from the linked URL and replaces it with a `[bla](URL)` style
    link.
* Removed status bar: to further simplify the SB UI. You can still pull up the
  same stat on demand with the `Stats: Show` command.
* The page switcher is now maintaining its ordering based on, in order:
  1. Last opened pages (in current session)
  2. Last modified date (on disk)
  3. Everything else
  4. The currently open page (at the bottom)
* Filter boxes (used for the page switching and command palette among other
  things) now also support PgUp, PgDown, Home and End and have some visual
  glitches fixed as well.
* Reverted exposing an empty `window` object to sandboxes running in workers and
  node.js (introduced in 0.0.28)
* Renamed Markdown-preview related commands to something more consistentnt
