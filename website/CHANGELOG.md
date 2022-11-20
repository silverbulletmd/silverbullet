An attempt at documenting of the changes/new features introduced in each
release.

---

## 0.2.1

* New `Plugs: Add` command

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

* Breaking change (for those who used it): the named anchor syntax has changed from `@anchorname` to `$anchorname`. This is to avoid conflicts with potentialy future use of `@` for other purposes (like mentioning people). Linking to an anchor still uses the `[[page@anchorname]]` syntax. So, you create an anchor $likethis you can then reference it [[@likethis]].
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

* Silver Bullet now runs on Windows!
* Frontmatter support! You can now use front matter in your markdown, to do this
  start your page with `---` and end it with `---`. This will now be the
  preferred way to define page meta data (although the old way will still work).
  The old `/meta` slash command has now been replaced with `/front-matter`.
* Tags are now indexed as page meta without the prefixing `#` character, the
  reason is to make this compatible with Obsidian. You can now attach tags to
  your page either by just using a `#tag` at the top level of your page, or by
  adding a `tags` attribute to your front matter.
* {[Search Space]} works again. You may have to {[Space: Reindex]} to get
  results. Search results now also snow a snippet of the page, with the phrase
  highlighted.
* Faster page indexing.
* `silverbullet` now has sub-commands. It defaults to just running the server
  (when passed a path to a directory), but you can also run
  `silverbullet --help` to see the available commands. Commands currently
  available:
  * `silverbullet upgrade` to perform a self upgrade
  * `silverbullet fix` to attempt to solve any issues with your space (deletes
    your `_plug` directory and `data.db` file)
  * `silverbullet plug:compile` replaces the old `plugos-bundle` command.
  * `silverbullet version` prints the current version

---

## 0.1.2

* Breaking plugs API change: `readPage`, `readAttachment`, `readFile` now return
  the read data object directly, without it being wrapped with a text object.
* A whole bunch of deprecated syscalls have been removed

---

## 0.1.0 First Deno release

* The entire repo has been migrated to [Deno](https://deno.land)
* This may temporarily break some things.
* If somehow you’re experiencing trouble, try the following:
  * Delete all files under `_plug` in your pages folder, e.g. with
    `rm -rf pages/_plug`.
  * Delete your `data.db`
* Changes:
  * `PLUGS` is now longer required
  * `PLUGS` no longer supports `builtin:` plug URLs, all builtins are
    automatically loaded and no longer should be listed.
* Plugs no longer should be built with node and npm, PRs will be issued to all
  existing plugs later to help with this transition.
* Know breakages:
  * Full text search is not yet implemented (the SQLite used does not support it
    right now)
  * Github auth has not been ported (yet)
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
* Technical change: Upgrades are now detected on the server-side, and plugs
  re-loaded and pages indexed upon every upgrade.
* Various bug fixes (e.g. using HTML tags in a page before completely broke
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
  linked from your page. Attachment size is currently limited to 100mb.
* Changed full-text search page prefix from `@search/` to `🔍` for the {[Search
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
  * This feature is now used in `website` and set to `Silver Bullet` there. To
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
