Another month, another new SilverBullet release. This one lands with a brand-new [Configuration Manager](https://silverbullet.md/Configuration%20Manager): a proper UI for editing common configuration options, managing key bindings, and installing libraries (`Ctrl/Cmd-,` to open). The [CLI](https://silverbullet.md/Runtime%20API) has been renamed from `silverbullet-cli` to `sb` with reworked commands. There's a new (experimental) [Markdown/Anchor](https://silverbullet.md/Markdown/Anchor) syntax (`$name`) for stable, space-globally unique names on (almost) any [Object](https://silverbullet.md/Object). And... “Lua Integrated Query” (LIQ) has been rebranded to [Space Lua Integrated Query](https://silverbullet.md/Space%20Lua/Integrated%20Query) — _SLIQ!_

# Changes
* [Configuration Manager](https://silverbullet.md/Configuration%20Manager): new UI for editing configuration, accessed via the `Configuration: Open` command (`Ctrl/Cmd-,`) and `Configuration: Key Bindings` commands. This is a work in progress, but should already be a big improvement over the old ways. It currently supports:
  * Changing (common) configuration options
  * Key binding management (oh my!)
  * A Library manager, superseding the old Library Manager UI (which now has been removed)
* [CLI](https://silverbullet.md/Runtime%20API) renamed from `silverbullet-cli` to `sb`, in addition:
  * renamed `lua` → `eval`
  * `luascript` → `script`
  * a new `describe` command that describes SLIQ and lists tags with defined schemas.
* New (experimental) [Markdown/Anchor](https://silverbullet.md/Markdown/Anchor) syntax (`$name`): a stable, space-globally unique name for (almost) any [Object](https://silverbullet.md/Object), referenced from links via `[[$name]]`.
* Rebrand: “Lua Integrated Query” (LIQ) is now called [Space Lua Integrated Query](https://silverbullet.md/Space%20Lua/Integrated%20Query) (_SLIQ!_) (as coined by Matouš Jan Fialka)
* API extensions for [API/config](https://silverbullet.md/API/config): `config.define` now propagates schema `default` values. New `config.defineCategory` / `config.getCategories` APIs, plus UI annotations for the configuration manager. The `ui.order` schema annotation and `config.defineCategory`'s `order` field have been renamed to `priority` and now sort *descending* (higher = appears earlier), matching the rest of SilverBullet's `priority` conventions.
* Server no longer generates a default `CONFIG.md` in empty spaces, this page is now auto created by the configuration manager when required.
* The legacy `plug-manager` has now been removed (superseded by the Library manager part of the Configuration Manager UI)
* [Plugs/Development](https://silverbullet.md/Plugs/Development) (now with new docs!) gains an optional `build:` section in manifests, running `esbuild`, `sass`, or `copy` transforms before asset bundling — enables plugs to ship bundled TSX/SCSS UIs.
* Action buttons: new `command` attribute for `actionButton.define`. When using this instead of a `run` callback, keyboard bindings will appear in the tooltip.
* Docker: removed `VOLUME` declaration from the Dockerfile (it gave a false sense of persistence `/space` must be explicitly mounted, as documented). This also fixed the silverbullet-website repo.
* Fix: [Sync](https://silverbullet.md/Sync) now falls through to local data on browser-native network errors instead of returning 503; previously synced spaces serve locally immediately after a service worker restart.
* Fix: navigation no longer blocks while the initial index is still running.
* Fix: rich text paste only worked on the second try
* Fix: indexing blew up with malformed bullet list items
* Fix: regression where aspiring pages were not deleted once the page was created.
* Fix: auto complete of meta pages was broken
* Fix: page rename failed when the page contains external URL links.
* Fix: too-tall mini editor in various pickers on Safari.
* Security fix: auth cookies now set stricter security flags (HttpOnly, Secure, SameSite); auth config file corruption no longer fails silently.
* Potentially **breaking** CSS change for theme authors: `.sb-notifications` has moved in the DOM (notifications now portal to `document.body`).
* New [API/system](https://silverbullet.md/API/system) syscalls `system.loadPlug` / `system.unloadPlug` for per-path plug (re)loading.
* New [API/editor](https://silverbullet.md/API/editor) syscall `editor.focus` for explicitly focusing the editor.
* Configuration Manager: Key Bindings tab now says "Filter commands" instead of "Search commands".
* More sensible fallback values for config options before the initial index has populated defaults.
* Lint: the `name` attribute uniqueness check is now limited to `#meta/library` pages.
* [Runtime API](https://silverbullet.md/Runtime%20API): better debug output when the headless Chrome instance fails to boot.
* Fix: more robust markdown tree traversal in the face of invalid markdown trees.
* Fix: [outline operation edge cases](https://github.com/silverbulletmd/silverbullet/issues/1936).
* Fix: button text wrapping.
* Fix: Runtime API fixed for users using PUID and PGUID users (by [Luminiferous348](https://github.com/Luminiferous348)).
* Fix: symlinks inside the space directory are no longer accidentally removed when cleaning up empty parent directories after a file delete.
* Fix: slash commands now resolve the syntax node ending at the cursor, so they no longer get incorrectly suppressed adjacent to comment blocks or links.
* Fix: [Service Worker is now built without `import` statements](https://github.com/silverbulletmd/silverbullet/pull/1949) so it loads on Firefox versions before 147 (by [Carlos Fdez. Llamas](https://github.com/sirikon)).

# Upgrading
* For docker-based install, pull the new image, stop the container and start a new one. For binary-based installs run `silverbullet --upgrade` and restart.
* After upgrading the server, make sure you reload all your SilverBullet tabs a few times, just to make sure the cache is flushed.

# Dedication
I've made the decision to reduce my regular day job to fewer days and spend the remainint time on SilverBullet. This allows for deeper focus and more ambitious work. If you like this, consider [sponsoring](https://silverbullet.md/Funding) to make this a little bit more financially viable for me.
