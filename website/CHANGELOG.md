An attempt at documenting of the changes/new features introduced in each (pre) release.

## 0.0.31
* Update to the query language: the `render` clause now uses page reference syntax `[[page]]`. For example `render [[template/task]]` rather than `render "template/task"`. The old syntax still works, but is deprecated, completion for the old syntax has been removed.
* Updates to templates:
  * For the `Template: Instantiate Page` command, the page meta value `$name` is now used to configure the page name (was `name` before). Also if `$name` is the only page meta defined, it will remove the page meta entirely when instantiating.
  * You can now configure a daily note prefix with `dailyNotePrefix` in `SETTINGS` and create a template for your daily note under `template/page/Daily Note` (configurable via the `dailyNoteTemplate` setting).
  * You can now a quick note prefix with `quickNotePrefix` in `SETTINGS`.
* Directives (e.g. `#query`, `#import`, `#inject`) changes:
  * Renamed `#template` directive to `#inject`
  * New `#inject-clean` directive will clean all the embedded queries and templates in its scope
  * All directives now use the page reference syntax `[[page name]]` instead of `"page name"`, this includes `#inject` and `#inject-clean` as well as `#import`.
  * The `link` query provider now also returns the `pos` of a link (in addition to the `page`)
  * New `$disableDirectives` page meta data attribute can be used to disable directives processing in a page (useful for templates)
* Added a new `/hr` slash command to insert a horizontal rule (`---`) useful for mobile devices (where these are harder to type)

## 0.0.30
* Slash commands now only trigger after a non-word character to avoid "false positives" like "hello/world".
* Page auto complete now works with slashes in the name.
* Having a `SETTINGS` page is now mandatory. One is auto generated if none is present.
* Added a `indexPage` setting to set the index page for the space (which by default is `index`). When navigating to this page, the page name will "disappear" from the URL. That is, the index URL will simply be `http://localhost:3000/`.
  * This feature is now used in `website` and set to `Silver Bullet` there. To also make the title look nicer when visiting https://silverbullet.md
  

## 0.0.29
* Added the `Link: Unfurl` command, which is scoped to only work (and be visible) when used on “naked URLs”, that is: URLs not embedded in a link or other place, such as this one: https://silverbullet.md
  * Plugs can implement their own unfurlers by responding to the `unfurl:options` event (see the [Twitter plug](https://github.com/silverbulletmd/silverbullet-twitter) for an example).
  * Core implements only one unfurl option: “Extract title” which pulls the `<title>` tag from the linked URL and replaces it with a `[bla](URL)` style link.
* Removed status bar: to further simplify the SB UI. You can still pull up the same stat on demand with the `Stats: Show` command.
* The page switcher is now maintaining its ordering based on, in order:
  1. Last opened pages (in current session)
  2. Last modified date (on disk)
  3. Everything else
  4. The currently open page (at the bottom)
* Filter boxes (used for the page switching and command palette among other things) now also support PgUp, PgDown, Home and End and have some visual glitches fixed as well.
* Reverted exposing an empty `window` object to sandboxes running in workers and node.js (introduced in 0.0.28)
* Renamed Markdown-preview related commands to something more consistent