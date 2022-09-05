An attempt at documenting of the changes/new features introduced in each 

---

## 0.0.33
* **Attachments**: you can now copy & paste or drag & drop files (images, PDF, whatever you like) into a page and it will be uploaded and appropriately linked from your page. Attachment size is currently limited to 100mb.
* Changed full-text search page prefix from `@search/` to `🔍` for the {[Search Space]} command.
* `page`, `plug` and `attachment` are now _reserved page names_, you cannot name your pages these (you will get an error when explicitly navigating to them).

---

## 0.0.32
* **Inline image previews**: use the standard `![alt text](https://url.com/image.jpg)` notation and a preview of the image will appear automatically. Example:
  ![Inline image preview](https://user-images.githubusercontent.com/812886/186218876-6d8a4a71-af8b-4e9e-83eb-4ac89607a6b4.png)
* **Dark mode**. Toggle between the dark and light mode using a new button, top-right.
  ![Dark mode screenshot](https://user-images.githubusercontent.com/6335792/187000151-ba06ce55-ad27-494b-bfe9-6b19ef62145b.png)
* **Named anchors** and references, create an anchor with the new @anchor notation (anywhere on a page), then reference it locally via [[@anchor]] or cross page via [[CHANGELOG@anchor]].

---
## 0.0.31
* Update to the query language: the `render` clause now uses page reference syntax `[[page]]`. For example `render [[template/task]]` rather than `render "template/task"`. The old syntax still works, but is deprecated, completion for the old syntax has been removed.
* Updates to templates:
  * For the `Template: Instantiate Page` command, the page meta value `$name` is now used to configure the page name (was `name` before). Also if `$name` is the only page meta defined, it will remove the page meta entirely when instantiating.
  * You can now configure a daily note prefix with `dailyNotePrefix` in `SETTINGS` and create a template for your daily note under `template/page/Daily Note` (configurable via the `dailyNoteTemplate` setting).
  * You can now a quick note prefix with `quickNotePrefix` in `SETTINGS`.
* Directives (e.g. `#query`, `#import`, `#use`) changes:
  * Renamed `#template` directive to `#use-verbose`
  * New `#use` directive will clean all the embedded queries and templates in its scope
  * All directives now use the page reference syntax `[[page name]]` instead of `"page name"`, this includes `#use` and `#use-verbose` as well as `#import`.
  * The `link` query provider now also returns the `pos` of a link (in addition to the `page`)
  * New `$disableDirectives` page meta data attribute can be used to disable directives processing in a page (useful for templates)
* Added a new `/hr` slash command to insert a horizontal rule (`---`) useful for mobile devices (where these are harder to type)

---
## 0.0.30
* Slash commands now only trigger after a non-word character to avoid "false positives" like "hello/world".
* Page auto complete now works with slashes in the name.
* Having a `SETTINGS` page is now mandatory. One is auto generated if none is present.
* Added a `indexPage` setting to set the index page for the space (which by default is `index`). When navigating to this page, the page name will "disappear" from the URL. That is, the index URL will simply be `http://localhost:3000/`.
  * This feature is now used in `website` and set to `Silver Bullet` there. To also make the title look nicer when visiting https://silverbullet.md

---
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