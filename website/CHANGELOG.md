An attempt at documenting the changes/new features introduced in each
release.

---

## 0.2.13

* Support for multiple `order by` clauses in [[🔌 Directive/Query]] by [Siddhant Sanyam](https://github.com/silverbulletmd/silverbullet/pull/387)
* Tags included in `tags` [[Frontmatter]] now included in hash tag auto complete
* Regression fix: when instantiating a page from a template it would always claim the page already existed (even if it didn't)

---

## 0.2.12

* Added support to override CSS styles on a per-space basis. This replaces the previous `fontFamily` setting. See [[STYLES]] for hints on how to use this new experimental feature.
* [[Sync]]: Support to exclude prefixes (via [[SETTINGS]])
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
* Fixed copy & paste, drag & drop of attachments in the [[Desktop]] app
* Continuous [[Sync]]
* Support for embedding [[Markdown/Code Widgets]].
* ~~Ability to set the editor font via the `fontFamily` setting~~ in [[SETTINGS]] (restart the app/reload the page to make it go into effect). **Update**: now done via [[STYLES]]

---
## 0.2.8
* [[Sync]] should now be usable and is documented
* Windows and Mac [[Desktop]] apps now have proper icons (only Linux left)
* [[Mobile]] app for iOS in TestFlight
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
* **New plug:** [[🔌 Collab]] for real-time collaboration on your pages.

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
* New {[Open Weekly Note]} command (weeks start on Sunday by default, to allow for planning, but you can change this to Monday by setting the `weeklyNoteMonday` to `true` in [[Settings]]). Like for {[Open Daily Note]} you can create a template in `template/page/Weekly Note`.
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
