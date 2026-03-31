An attempt at documenting the changes/new features introduced in each release.

## Edge
Whenever a commit is pushed to the `main` branch, within ~5 minutes, it will be released as a docker image with the `:v2` tag, and a binary in the [edge release](https://github.com/silverbulletmd/silverbullet/releases/tag/edge). If you want to live on the bleeding edge of SilverBullet goodness (or regression) this is where to do it.

* **Technical: Deno → Node.js migration**: The TypeScript/client codebase has been migrated from Deno to Node.js, now using vitest for tests. This _should_ purely be a tooling change.
* **[[Runtime API]]** and accompanying [[CLI]] (==Experimental==): programmatically interact with a (remote) SilverBullet server over via `silverbullet-cli` or a [[Runtime API|HTTP API]]: evaluate Lua expressions, run scripts, and retrieve console logs. Powered by a headless Chrome instance running the full SilverBullet client via CDP, so all results reflect live client state.
* Live Preview for HTML tags: inline HTML in markdown (e.g. `<marquee>Hello **there**</marquee>`) now renders as actual HTML elements in the editor, with full markdown support inside the tags.
* [[Outlines]] commands have been thoroughly reworked. Should now be more robust and better tested outline move/indent operations. New features:
  * Now also works with numbered items (and renumbers them)
  * Now works with headers (moves around entire sections)
  * Now works with table rows
  * Now works with paragraphs
* [Footnote support](https://www.markdownlang.com/extended/footnotes.html): both reference-style (`[^1]`) and inline (`^[text]`) footnotes with syntax highlighting, live preview on hover, reference completion, and invalid reference linting.
* Client upgrade notification: if the server is updated but the client version doesn't match, a notification will appear instructing the user to reload.
* The [[^Library/Std/Widgets/Widgets#Table of contents]] widget is now **collapsible**, defaults to open (by [Dobli](https://github.com/Dobli)).
* [Improved Lua widget rendering](https://github.com/silverbulletmd/silverbullet/pull/1876) (by [Matouš Jan Fialka](https://github.com/mjf)): `${...}` expressions now render scalars, arrays, records, and arrays-of-tables with better HTML and markdown output.
* [[Task]] `Task: Clean Completed` now handles more scenarios, and leaves a cleaner outline.
* [Panels now use Shadow DOM elements instead of iframes](https://github.com/silverbulletmd/silverbullet/pull/1819) (by [onespaceman](https://github.com/onespaceman)).
* `editor.flashNotification` now supports an optional third argument with `timeout` (use `0` for persistent notifications) and `actions` (buttons with callbacks).
* Fix: [table cell alignment for missing and misaligned cells](https://github.com/silverbulletmd/silverbullet/pull/1873) 
* Fix: [handle tagged floats before plain object check in `renderCellContent`](https://github.com/silverbulletmd/silverbullet/pull/1876) (by [Matouš Jan Fialka](https://github.com/mjf)).
* Fix: document file opening with URL prefix.
* Fix: autofocus on authentication page.
* Fix: mini editor regressions.
* [Custom markdown syntax extensions](https://github.com/silverbulletmd/silverbullet/pull/1881) (==Experimental==): define custom inline syntax via [[API/syntax]] that gets parsed, highlighted, and rendered in live preview.
* [[Space Lua/Lua Integrated Query]] improvements (courtesy of [Matouš Jan Fialka](https://github.com/mjf)):
  * [Unified field list syntax](https://github.com/silverbulletmd/silverbullet/pull/1909) for `from`, `select`, and `group by` clauses, enabling multi-source cross-joins
  * [Implicit single group](https://github.com/silverbulletmd/silverbullet/pull/1907) for aggregates without `group by`
  * `offset` clause support
  * Intra-aggregate `order by` support
  * [13 new aggregate functions](https://github.com/silverbulletmd/silverbullet/pull/1891) (`product`, `string_agg`, `yaml_agg`, `json_agg`, `bit_and`, `bit_or`, `bit_xor`, `bool_and`, `bool_or`, `stddev_pop`, `stddev_samp`, `var_pop`, `var_samp`), `aggregate.alias` API for custom aliases, and `index.aggregates` queryable collection
* Mobile: "lock" button to toggle read-only, useful for navigating without accidentally editing.
* Action Button enhancements:
  * `standalone` option: only show certain action buttons in standalone/PWA mode (e.g. forward/back navigation buttons)
  * Support for opting out action buttons from the mobile dropdown menu
* Bundle size optimization: chunked builds with ESBuild, JIT loading of larger modules (vim, syntax modes).
* Fix: "No such header #boot" errors in PWA mode.
* Fix: Edit buttons now work correctly for Lua expressions and code widgets whose bodies appear multiple times in the same page.
* Fix: [attribute rendering](https://github.com/silverbulletmd/silverbullet/pull/1880).
* Fix: [Markdown table rendering](https://github.com/silverbulletmd/silverbullet/pull/1879) and removal of deprecated command button remnants.
* [[Task]] improvements (by [Matouš Jan Fialka](https://github.com/mjf)):
  * [Dropdown picker for custom task states](https://github.com/silverbulletmd/silverbullet/pull/1900) with autocomplete and per-state CSS styling via `data-task-state` attribute
  * [Improved task widget](https://github.com/silverbulletmd/silverbullet/pull/1905): toggle dropdown on re-click, narrowed decoration range for better cursor behavior
* Performance: Lua interpreter hot-path optimizations, tree traversal and page index optimizations.
* Performance: `LuaTable` internals tuned for faster Lua execution.
* [[API/shell#shell.run(cmd, args, stdin?)]]: `shell.run` now accepts an optional `stdin` parameter (by [Brett Anthoine](https://github.com/banthoine)).
* Sync: further edge case fixes (timestamp/content-length mismatch, service worker activation).
* Subtle **breaking** change: `template.each` now returns an empty string on empty results instead of `nil`.
* Fix: only `#meta` and `#meta/` prefixed tags are now considered meta tags, not e.g. `#metabase`.
* Fix: TOC rendering when headers contain a numbered list item.
* Fix: edge case where the markdown link regex could go into infinite loop (links with escaped square brackets).
* Fix: unwrap multi-return values in PropertyAccess and method calls (by [Brett Anthoine](https://github.com/banthoine)).
* Fix: allow colons in `SB_USER` password (by [Joshua Brunner](https://github.com/joshuabrunner)).
* Fix: mobile tasks caret jumping and empty widgets on navigation.
* Mobile: home button moved outside of the dropdown menu; hamburger menu style tweaks.
* Fix: extended task state widget click behavior and rendering in widgets.
* Fix: safer handling of default template files in non-empty spaces.
* Frontmatter `tags:` key now has autocomplete support.
* Fix: 32-bit ARM Docker builds.
* Fix: reduce visual bouncing when navigating between pages.
* Fix: encode URLs with dots in path names on WebKit/Safari (fixes opening e.g. PDF files).

## 2.5.0
* Changed keyboard bindings (sorry!). CodeMirror no longer directly allows `Alt-<letter>` and `Alt-<special-character>` [[Keyboard Shortcuts]], meaning I had to **remap a few key bindings**. It’s basically a mission impossible to pick great ones, but here are the new defaults:
  * `Quick note` is now bound to both `Ctrl-q q` (type `Ctrl-q` first, then hit `q` again) and `Ctrl-q Ctrl-q` (hit `Ctrl-q` twice)
  * `Navigate: Home` is now bound to `Ctrl-g h`
  * `Text: Marker` is now bound to `Ctrl-Alt-m`
  * [[Outlines]] commands generally now use a `Mod-.` (`Cmd-.` on mac, `Ctrl-.` on Linux/Windows) prefix:
    * `Outline: Move Right`: `Mod-. l`
    * `Outline: Move Left`: `Mod-. h`
    * `Outline: Move Up`: `Alt-ArrowUp` still works, but now also adds `Mod-. k` for consistency
    * `Outline: Move Down`: `Alt-ArrowDow` still works, but now also adds `Mod-. j` for consistency
    * `Outline: Toggle Fold`: `Mod-. Mod-.`
    * `Outline: * Fold` (other fold commands): keyboard disabled, readd yourself if you need them (see [[Keyboard Shortcuts]])
    * `Task: Cycle State`: `Mod-. t`
  * `Page: Rename` keyboard shortcut removed
  * `Page: Rename Linked Page` keyboard shortcut removed
  * `Sync: Space` keyboard shortcut removed
  * As documented in [[Keyboard Shortcuts]], it is now possible to specify _multiple_ keyboard shortcuts to a commands.
* [[Sync]] reliability work:
  * Better indication whether your page is synced to the server: “Dirty state” (slightly tinted color of page name) is now aligned with actual synced-to-server state _unless_ the editor clearly indicates it is in offline mode (yellow top bar).
  * Sync snapshots are now persisted after every file sync, reducing (and hopefully eliminating) edge cases where the sync engine is killed mid-sync (for whatever reason) and the snapshot becomes of sync with “reality”.
  * The index status progress indicator (blue circle) should now be more reliably reflect the actual indexing status.
  * HTTP status codes >= 500 are now treated as offline (better offline detection).
* [[Space Lua/Lua Integrated Query]] improvements (courtesy of [Matouš Jan Fialka](https://github.com/mjf)):
  * [[Space Lua/Lua Integrated Query/Grouping|group by]] and `having` clauses with [[Space Lua/Lua Integrated Query/Aggregating|aggregator]] support
  * `filter(where <cond>)` clause for per-row aggregate filtering
  * `nulls first`/`nulls last` in `order by`
  * Null/missing query cells now render as empty
* [[Space Lua]] engine general improvements (most courtesey of [Matouš Jan Fialka](https://github.com/mjf)):
  * [Native Lua pattern matching engine](https://github.com/silverbulletmd/silverbullet/pull/1838) (replacing previous implementation)
  * [Support for `<close>` attribute and __close metamethod](https://github.com/silverbulletmd/silverbullet/commit/9419cdcd9be61908330e1dce68a9156dbb911d23)
  * [Better arithmetic error messages](https://github.com/silverbulletmd/silverbullet/commit/5a20a5f8f476a98172609e80c799cd1d83765585)
  * [Refactor of control flow (performance)](https://github.com/silverbulletmd/silverbullet/commit/e5b4c8feb22a44cb4b22b3a77f9f2ed21dd09297)
  * [Improved numeric type semantics](https://github.com/silverbulletmd/silverbullet/pull/1803)
  * Implement `string.pack`, `string.unpack` and `string.packsize`
  * Implement `math.random`, `math.randomseed`, `math.tointeger`, `math.frexp` and `math.ldexp`
  * Implement `table.move`; align `table.pack` and `table.unpack` with Lua semantics
  * [[API/table#table.select(table, keys...)]] (non-standard in Lua) API, convenient to use in [[Space Lua/Lua Integrated Query]] `select` clauses, see example in docs.
  * [Extend `os` module](https://github.com/silverbulletmd/silverbullet/pull/1836)
  * Add `_VERSION` environment variable
  * `tostring()` now respects `__tostring` metamethod; `#` operator now respects `__len` metamethod
  * Fix: `table.sort` comparator, `string.gsub` table replacement, `math.modf` return types, number formatting in `..` and `table.concat`
  * **Load order** of scripts is now well defined: `order by (script.priority or 0) desc, script.ref`
* New _experimental_ API: [[API/tag#tag.define(spec)]], see linked page for docs and example uses. Brings back ability to define 📅 deadlines for tasks (see example). Another part of this is [[Schema]] support for [[Tag|tags]]. When a schema is defined for a tag, you get:
  * [[Frontmatter]] **attribute completion and linting** (in-editor error indicators) for attributes defined as part of the tag’s schema.
  * [[Space Lua/Lua Integrated Query]] **attribute code completion** _if_ you use the `from v = index.tag(“bla”)` style syntax (so explicitly bind your iterator variable).
  * Item-level linting (highlights the object in-line in case of validation errors).
* Tag schema updates:
  * `pos` (present in link, item and some other tags) is now _deprecated_, use `range` instead
  * `range` is a tuple of two numbers: _from_ and _to_ (e.g. `{0, 10}`) identify where the object appears in the page
* Editor improvements:
  * New `Page: Create Under Cursor` command, useful to pre-create an aspiring page link. Put your cursor in a wiki link to a non-existing page, and hit `Cmd-Shift-Enter` (`Ctrl-Shift-Enter`) to create it (empty) without navigating there.
  * [[Linked Mention|Linked Mentions]] now list full page path rather than abbreviated version.
  * Hide vertical scrollbar overflow for long page names.
  * Upload file: prompt user before replacing files and no-clobber behavior for paste uploads (by [Oliver Marriott](https://github.com/rktjmp)).
  * Trim user input from prompts where appropriate (by [rktjmp](https://github.com/rktjmp)).
  * Consider empty string as invalid path (by [rktjmp](https://github.com/rktjmp)).
* Styling changes:
  * Attribute names and values ([key: value] notation) now get different CSS classes in the editor: `sb-attribute-name` for names and `sb-attribute-value` for values.
  * The `diff` [[Markdown/Fenced Code Block]] language now uses colors to indicate additions and removals (by [Lajos Papp](https://github.com/silverbulletmd/silverbullet/pull/1807)).
* Configuration:
  * New `shortWikiLinks` config (defaulting to `true`) that decides whether a wiki link should be rendered in its short form (rendering just the last segment, e.g. `Person/John` would show as `John`). To always render the full name, put `config.set(“shortWikiLinks”, false)` in your [[CONFIG]].
  * [[Authentication]]: how long “remember me” works is now configurable (by [Metin Yazici](https://github.com/silverbulletmd/silverbullet/pull/1796)) via [[Install/Configuration]] and more reliably persisted.
* [[Library Manager]]: SilverBullet now navigates to library page after installing one.
* Now excluding `.plug.js` and `.js.map` files from the document list.
* Fix: bring back [[Virtual Pages]].

## 2.4.0
* Indexer rework (note: upgrading will start a full space reindex automatically):
  * Performance: up to 2x faster
  * Internal refactor, actually adding at least (rudimentary) unit tests now (imagine!)
  * `item` and `task` now also index (wiki) links and inherited (wiki) links (links appearing in parent nodes), as [requested here](https://community.silverbullet.md/t/coming-from-logseq-outlines-and-linked-mentions/290) under `links` and `ilinks`. Updated the "Linked Tasks" widget now to rely on `ilinks`.
  * Rewrote snippet text for links (used in [[Linked Mention|Linked Mentions]]) to be more contextual, now also includes child bullet items, see [community discussion](https://community.silverbullet.md/t/coming-from-logseq-outlines-and-linked-mentions/290).
  * For consistency with items, `task` `refs` now point to the item’s position resulting in a slight positional shift, if you have code relying on this, you may have to adjust it.
  * Disabled indexing all paragraph text by default, this caused significant indexing overhead. [See discussion](https://community.silverbullet.md/t/who-is-using-paragraph-for-queries/3686).
    To re-enable: `config.set("index.paragraph.all", true)`
  * Better link support in frontmatter (by [Tomasz Gorochowik](https://github.com/silverbulletmd/silverbullet/pull/1711))
  * The `page:index` event now also receives a `text` and `meta` attributes.
* [[Transclusions]] improvements:
  * Now have an “eye” button to navigate to the transcluded location
  * Transclusions now only live preview when the cursor is outside of them (as with other pieces of markup)
  * Transclusions now properly support headers
  * Items and tasks are now transcluded with their children (based on `@pos` notation) (this is mostly helpful when used in queries)
* Page/document/meta picker tweaks:
  * Upgraded the [Fuse.js](https://www.fusejs.io) library and tuned the ranking parameters, hopefully leading to better results.
  * Meta picker now more consistent with page picker
  * You can now use `Alt-space` to complete a folder matching the first result — try it and let me know how this works for you in practice.
* **Built-in full-text search has been removed** from the main distribution, this has now been moved to [a separate repo](https://github.com/silverbulletmd/basic-search) (installable via the library manager). Rationale: full text indexing is expensive and the search results were quite bad. Recommendation: install [Silversearch](https://github.com/MrMugame/silversearch) as an alternative.
* [[Task|Tasks]]:
  * `taskstate` objects are no more. Custom task states should now be defined using the [[API/taskState]] API.
  * **Removed:** deadline syntax (legacy syntax from v1) for tasks, please use attributes instead (e.g. `[deadline: "2026-01-01"]`).
* New APIs:
  * [[API/space#space.readFileWithMeta(name)]]
  * [[API/space#space.readPageWithMeta(name)]]
  * [[API/space#space.readRef(ref)]]
  * [[API/taskState#taskState.define(def)]] (see “Tasks” above)
* New commands:
  * `Navigate: Copy Ref To Current Position`
  * `Navigate: Copy Link To Current Position`
* Lua:
  * [LIQ fix](https://github.com/silverbulletmd/silverbullet/issues/1705)
  * [Ctrl-click](https://github.com/silverbulletmd/silverbullet/pull/1713) navigate to definition on non-Mac operating systems
  * Support for `<const>` in Lua (by [Matouš Jan Fialka](https://github.com/silverbulletmd/silverbullet/pull/1715))
* Production builds now include sourcemaps for easier debugging in browser DevTools. If you don't want to serve sourcemaps publicly, you can block `*.js.map` files at your reverse proxy level (see [[TLS#Blocking sourcemaps]]).
* Should now **deal better with authentication layers** (Cloudflare Zero Trust, Authelia, Pangolin)
* [Sync errors](https://github.com/silverbulletmd/silverbullet/issues/1720) now propagate better to the UI
* Document editors now fixed in Safari (by [MrMugame](https://github.com/silverbulletmd/silverbullet/pull/1710))
* `%` now supported in [page names](https://github.com/silverbulletmd/silverbullet/issues/1694)
* Lua widgets “flapping” should now be less

## 2.3.0
This release (re)introduces [[Share]], formalizes [[Library]], and introduces in initial version of the [[Library Manager]], a type of package manager for SilverBullet. It also progresses on Lua 5.4 compatibility.

Here’s what’s new:

* [[Share]]: a new mechanism to push content to external places and pull external content in (also used as the foundation of [[Library]]). This partially replaces many [[Export]] use cases. Export will be more for one-off use cases.
* [[Library]]: are now a more “real” thing, and can be distributed via the [[Library Manager]] and curated with [[Repository]]. For instructions on how to build your own libraries, see [[Library/Development]]. Eventually, this mechanism will succeed the `plugs` configuration and `Plugs: Update` mechanism. Plug authors can already start to update their plugs to get ready, usually all that needs to be done is to add a `PLUG.md` file to their repository: [example](https://github.com/silverbulletmd/silverbullet-mermaid/blob/main/PLUG.md).
* [[Service]]: a new mechanism used behind the scenes to power [[Share]], but also [[Export]] and likely other features in the future. Built on top of [[Event]].
* [[URI]] are now a more formalized and centralized mechanism, used by [[Share]] and likely other features in the future.
* Removed “Import” support, succeeded by [[Share]].
* [[Tag Picker]]: to quickly navigate to tag pages
* Space Lua improvements (courtesy of Matouš Jan Fialka):
  * Support for `goto` (yes, I said I’d never add it, but Matouš did anyway)
  * Significant [performance leaps](https://github.com/silverbulletmd/silverbullet/pull/1666)
  * Support [\t](https://github.com/silverbulletmd/silverbullet/pull/1698) in strings
* More of an in-your-face error when you’re not using [[TLS]] and you should, with instructions how to fix it: even though using plain HTTP was never a supported configuration, it hard-broke in 2.2.1
* Plugs are now loaded from anywhere in the space, as long as they end with `.plug.js` (so no longer need to be in `_plug`, in fact all shipped core plugs are now mounted under `Library/Std/Plugs`)
* Automatically follow system dark mode (by [Lelouch He](https://github.com/silverbulletmd/silverbullet/pull/1696))
* Fix Youtube embes (by [Rodolfo Souza](https://github.com/silverbulletmd/silverbullet/pull/1672))

Upgrade notes:

* If you have third-party plugs installed and intend to reinstall them as Libraries: be sure to delete the old versions first. You can do so by cleaning out your `_plug` folder right on the file system, or use the document picker, filter on `plug.js` and delete every single document that’s in the `_plug` folder that way.
* If you somehow end up in a state where SilverBullet doesn’t load properly, have a look at [[Troubleshooting]] for hints on what to try to fix it.

## 2.2.0
This is a dot release primarily because due to changes in how IndexedDB databases are named, a fully resync and reindex of your space will happen on all your devices. I’m sorry for the inconvenience, we try to limit how often this is required. If you’d like to clean up unnecessary databases afterwards you can run the `Client: Clean` command (once) afterwards.

* [[Client Encryption]]: when using a untrusted device (e.g. a public computer), enable this option when logging in (only supported with built-in [[Authentication]]) to encrypt all locally stored data (at a performance penalty).
* Lua fixes, making [[Space Lua]] more compatible with Lua 5.4 (most courtesy of of Matouš Jan Fialka):
  * [Fix length (`#` operator) features](https://github.com/silverbulletmd/silverbullet/pull/1637)
  * [Add `rawget` and `rawequal`](https://github.com/silverbulletmd/silverbullet/pull/1647)
  * [Allow `..` to also concatenate strings and numbers](https://github.com/silverbulletmd/silverbullet/pull/1648)
  * [Make truthiness more Lua compatible](https://github.com/silverbulletmd/silverbullet/pull/1644)
  * [Align arithmetic model with standard Lua](https://github.com/silverbulletmd/silverbullet/pull/1611)
  * [Add `huge` constant and `type` to `math.*` API](https://github.com/silverbulletmd/silverbullet/pull/1632)
  * [Add `load` function](https://github.com/silverbulletmd/silverbullet/pull/1631)
  * [Support %u in os.date](https://github.com/silverbulletmd/silverbullet/issues/1598)
  * [Pass on status code differently when using `http.request`](https://github.com/silverbulletmd/silverbullet/issues/1608)
* More video embeds in standard library (courtesy of Andy Costanza):
  * [Vimeo](https://github.com/silverbulletmd/silverbullet/pull/1616)
  * [Peertube](https://github.com/silverbulletmd/silverbullet/pull/1612)
* New `widget.htmlBlock` and `widget.markdownBlock` convenience APIs for creating block widgets (that take the full width of the screen rather than being inlined)
* The [[^Library/Std/APIs/DOM]] API now supports embedded widgets and markdown
* The markdown renderer now renders ${"`inline code`"} as a `code` tag with `.sb-code` class
* Atomic upgrades with `silverbullet update` and `silverbullet update-edge` (by [Mihai Maruseac](https://github.com/silverbulletmd/silverbullet/pull/1634))
* Added `Client : Clean` command that deletes all redundant IndexedDB databases (ones the client is not using)
* Very basic Prometheus metrics (see [[Install/Configuration#Metrics]])
* Fix: bottom search bar dark mode styling (by [numan](https://github.com/silverbulletmd/silverbullet/pull/1614))
* Fix: navigation with auto links (by [MrMugame](https://github.com/silverbulletmd/silverbullet/pull/1607))
* Fix: `SB_USER` now works with `SB_URL_PREFIX`

## 2.1.8
* New [[^Library/Std/APIs/Virtual Page]] API, internally used by:
  * [[^Library/Std/Infrastructure/Tag Page]]
* Some fixes in `tonumber` handling
* Default table renderer now renders `ref` attributes as links, so they’re clickable:
  ${query[[from index.tag "page" limit 3 select {ref=ref, lastModified=lastModified}]]}
* Fix: render TOC correctly when header itself contains a link (by [Oleksandr Kuvshynov](https://github.com/silverbulletmd/silverbullet/pull/1597))
* Fix: read-only pages are now _never_ saved back to your space (could happen, e.g. with tasks on tag pages)
* Fix: Table of Contents widget works again
* Fix: Poor behavior when multiple pages are delete in sequence (by [Oleksandr Kuvshynov](https://github.com/silverbulletmd/silverbullet/pull/1599))
* Lua:
  * Setting a table value to `nil` now deletes it as a key, so it no longer appears in `table.keys`

## 2.1.7
* Restructure of the `Library/Std` library, added some more (self) documentation. See [[^Library/Std]] as an entry point.
* Re-added `page:saved` event that was removed in 2.1
* When the clipboard API is used in Safari, will now give a proper error (Safari restriction) by ([Noah Stanley](https://github.com/silverbulletmd/silverbullet/pull/1575))
* Full text search results now show full page path
* Space folders now support symlinks again (regression from 2.1)
* Lua: fixes in arithmetic model (by [Matouš Jan Fialka](https://github.com/silverbulletmd/silverbullet/pull/1587))
* Lua: Removed unary plus from grammar (wasn’t actually supported) (by [Matouš Jan Fialka](https://github.com/silverbulletmd/silverbullet/pull/1585))
* Bugfix: auth and service worker caching fixes
* Bugfix: docker health check failed when SB_URL_PREFIX was used
* Bugfix: infinite item index loop in obscure cases

## 2.1.4 - 2.1.6
* Fixed broken auth in Safari
* Renamed the inconstently named `index.search.enable` to `index.search.enabled`
* Last opened (for pages) and last run (for commands) timestamps are now kept persistently between client loads (and tabs)
* Fixed docker user and group creation issues
* Removed `file:deleted` triggering when checking for `getFileMeta` (causing an infinite indexing loop in SilverSearch)
* Server: HTTP Gzip compression is now enabled for sensible content types
* Nicer syntax to query tag objects from the index: `tags.page` becomes an alias for `index.tag "page"` (implemented here: [[^Library/Std/APIs/Tag]])
* Hidden files and folders (starting with `.`) are no longer synced, as well as files without a file extension (those were not support anyway)

## 2.1.2
This is a major architectural overhaul compared to 2.0. Please — as always — make sure you regularly backup your space files to avoid any data loss. Nothing should happen, but better be safe than sorry!

* All new server written in Go (previously written using Deno). Uses significantly less memory and is significantly smaller in size.
* Docker base image is now based on Alpine (previously Ubuntu), further reducing memory and disk space usage.
* Significant engine re-architecture: see [[Architecture]] and [[Sync]], now lives in the service worker and parallelizes sync. Once upgrading a full resync will need to happen. Documents are no longer synced by default (you can enable this via config, see [[Sync]]).
* More configuration options for what to index (see [[^Library/Std/Config]] under the `index` section) for the purpose of reducing local storage size and needless CPU waste. Some useful ones:
  * `config.set("index.search.enabled", false)` to disable [[Full Text Search]] entirely (saves on processing and storage if you don’t use it)
  * `config.set("index.paragraph.all", false)` to disable indexing all (untagged) paragraphs. This is also somewhat wasteful if you don’t query these.
* Disable ability to rename pages in read-only mode (by [Jelenkee](https://github.com/silverbulletmd/silverbullet/pull/1509))
* Improved docker build + health check (by [Zef](https://github.com/silverbulletmd/silverbullet/issues/1515))
* Added `templates.tagItem` template (by [Andy Costanza](https://github.com/silverbulletmd/silverbullet/commit/6d4f964a6e2a4f7dae04aa7558defcaa9f1f1a86))
* Support links in table queryable objects (by [Alex Dobin](https://github.com/silverbulletmd/silverbullet/commit/f5aef74a87bc92c133968a37f992fe0c2b25ccf4))
* Refactor of document editors (by [MrMugame](https://github.com/silverbulletmd/silverbullet/commit/4706be29e6a155bdd4c3aa7508a0383496d77369))
* Command to toggle markdown syntax rendering (by [aphymi](https://github.com/silverbulletmd/silverbullet/commit/6914d4bc319781b4dc2b0d657bee77db405af2bf))
* Fix transclusions not being indexed as links (by [MrMugame](https://github.com/silverbulletmd/silverbullet/pull/1539))
* Render links inside frontmatter code as clickable anchors (by [Andy Constanza](https://github.com/silverbulletmd/silverbullet/pull/1552))
* New `SB_LOG_PUSH` option asking clients to push their browser JS logs to the server so they’re visible there.
* Hot reloading plugs has been disabled because it caused some nasty race condition. To explicitly reload plugs without restarting the client, use the `Plugs: Reload` command.

## 2.0.0
* We’re now live!

For previous versions, see [the v1 CHANGELOG](https://v1.silverbullet.md/CHANGELOG)
