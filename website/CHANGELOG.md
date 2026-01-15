An attempt at documenting the changes/new features introduced in each release.

## Edge
Whenever a commit is pushed to the `main` branch, within ~10 minutes, it will be released as a docker image with the `:v2` tag, and a binary in the [edge release](https://github.com/silverbulletmd/silverbullet/releases/tag/edge). If you want to live on the bleeding edge of SilverBullet goodness (or regression) this is where to do it.

* Indexer rework:
  * Performance: up to 2x faster
  * `item` and `task` now also index (wiki) links and inherited (wiki) links (links appearing in parent nodes), as [requested here](https://community.silverbullet.md/t/coming-from-logseq-outlines-and-linked-mentions/290) under `links` and `ilinks`. Updated the "Linked Tasks" widget now to rely on `ilinks`.
  * Rewrote snippet text for links (used in [[Linked Mention|Linked Mentions]]) to be more contextual, now also includes child bullet items, see [community discussion](https://community.silverbullet.md/t/coming-from-logseq-outlines-and-linked-mentions/290).
  * For consistency with items, `task` `refs` now point to the item’s position resulting in a slight positional shift, if you have code relying on this, you may have to adjust it.
  * The `page:index` event now also receives a `text` and `meta` attributes.
  * Disabled indexing all paragraph text by default, this caused significant indexing overhead. [See discussion](https://community.silverbullet.md/t/who-is-using-paragraph-for-queries/3686).
    To re-enable: `config.set("index.paragraph.all", true)`
  * Better link support in frontmatter (by [Tomasz Gorochowik](https://github.com/silverbulletmd/silverbullet/pull/1711))
* [[Transclusions]] improvements:
  * Now have an “eye” button to navigate to the transcluded location
  * Now properly support headers
  * Items and tasks are now transcluded with their children (based on `@pos` notation) (this is mostly helpful when used in queries)
* Page/document/meta picker tweaks:
  * Upgraded the underlying [Fuse.js](https://www.fusejs.io) library and tuned the ranking parameters, hopefully leading to better results.
  * Meta picker now more consistent with page picker
  * You can now use `Alt-space` to complete a folder matching the first result — try it and let me know how this works for you in practice.
* **Full-text search has been removed** from the main distribution, this has now been moved to [a separate repo](https://github.com/silverbulletmd/basic-search) (installable via the library manager). Rationale: full text indexing is expensive and the search results were quite bad. Recommendation: install [Silversearch](https://github.com/MrMugame/silversearch) as an alternative.
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
* Fixes:
  * Should now deal better with authentication layers (Cloudflare Zero Trust, Authelia, Pangolin)
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
