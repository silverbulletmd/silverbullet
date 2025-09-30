An attempt at documenting the changes/new features introduced in each release.

## Edge
These are changes live on the edge builds:

* _Nothing yet since 2.1.6_

## 2.1.4 - 2.1.6
* Fixed broken auth in Safari
* Renamed the inconstently named `index.search.enable` to `index.search.enabled`
* Last opened (for pages) and last run (for commands) timestamps are now kept persistently between client loads (and tabs)
* Fixed docker user and group creation issues
* Removed `file:deleted` triggering when checking for `getFileMeta` (causing an infinite indexing loop in SilverSearch)
* Server: HTTP Gzip compression is now enabled for sensible content types
* Nicer syntax to query tag objects from the index: `tags.page` becomes an alias for `index.tag "page"` (implemented here: [[^Library/Std/Tag]])
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
