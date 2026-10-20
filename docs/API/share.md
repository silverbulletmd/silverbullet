---
tags: api/space-lua
references:
- libraries/Library/Std/Infrastructure/Share.md
---

APIs and extension points of [[Share]], which publishes a page to, pulls it from, or syncs it with an external location; see [[^Library/Std/Infrastructure/Share]] for the implementation. The location is a [[URI]] kept in the page's `share.*` frontmatter.

# API
## share.sharePage(name?)
Shares a page according to its `share.*` frontmatter, the same as the {[Share: Page]} command. Without a name it shares the current page. Returns `true` when something was shared, `false` when there was nothing to do, and `nil` when the user was already notified of the outcome (a conflict). Errors with `Not configured` when the page has no `share.uri`.

## share.shareMany(names, opts?)
Shares the pages in order with `share.sharePage`. `opts.onProgress(index, total, name)` is called before each page, and `opts.cancelled()` is also checked before each page: when it returns true the run stops and the remaining pages are left out of the result. Returns a table keyed by page name with `{ok = true, result = ...}` or `{ok = false, error = ...}`; one failing page doesn't stop the others.

## share.status(name)
Tells offline whether a page changed locally since this device last shared it, without reading the remote. Returns `{uri, mode, state}` where `state` is `unchanged`, `localChanged`, or `unknown` when there is nothing to compare with: this device has no record of the last share and the page has no matching `share.hash` left from an older version.

## share.check(names)
Reads the remotes of the given pages and compares them with the local pages and the content this device last shared. Never prompts, connects, signs in or writes: a remote that needs a sign-in is reported as an error. Returns a table keyed by page name with `{uri, mode, state}` where `state` is one of:
* `upToDate`: the remote has what would be sent.
* `missing`: nothing at the remote yet.
* `localChanged`: only the local page changed.
* `remoteChanged`: only the remote changed.
* `bothChanged`: both changed.
* `differs`: they differ, but this device can't tell which side changed.
* `error`: reading failed, with the message in `error`.

## share.prepare(name, text)
Returns `{m, mode, outgoing}` for a page: its `share` frontmatter table, the mode (`push` when unset), and the text that goes to the remote. For `push` that is `text` run through [[#share.transform(text, ctx)]] with the steps resolved for the target of the URI; for `pull` and `sync` it is `text` with only the `share.*` keys removed. Errors with `Not configured` when the page has no `share` table.

## share.legacyHash(content)
Returns the 8-character hash older versions stored in `share.hash` (the sha256 of the text without its `share.*` keys). It is only used to recognize pages that were shared before this device kept its own record of what it last shared, so such a page that hasn't changed doesn't prompt after an update.

## share.contentHash(content)
Deprecated alias of `share.legacyHash`.

## share.isManaged(name, text)
Returns true for pages tagged `meta/library` or `meta/repository` (installed libraries and repositories), whose remote is the source of truth: a `pull` of such a page overwrites local changes without asking when this device has no record of the last share and the page has no `share.hash` left from an older version (when it has one, a mismatch asks first).

## share.ensureTransport(uri)
Makes sure a transport exists for a URI by invoking the first matching `share:ensure` service, if any. Called before sharing in `push` and `sync` mode. Errors from the service are passed on and stop the share.

## share.setFrontmatter(m, text)
Returns `text` with the `share.uri`, `share.mode` and `share.transform` frontmatter keys set from the table `m` (`uri`, `mode`, `transform`). Keys missing from `m` are left as they are. No `share.hash` is written any more.

## share.cleanFrontmatter(text)
Returns `text` with all `share.*` keys removed (including a leftover `share.hash`).

## share.transform(text, ctx)
Returns what a push sends: `text` without its `share.*` keys, with the steps enabled in `ctx.steps` applied (see [[Share#What gets published]]). `ctx` is a table with:
* `page`: the name of the page.
* `uri`: the URI it is shared to.
* `target`: the descriptor of the provider, see [[#share:target:<uri>]].
* `members`: a table mapping the names of the pages that are shared together to their URIs, used to tell links inside the share from links outside it. `share.prepare` passes just the page itself, so links to other pages become text.
* `steps`: a table of booleans for `links`, `comments`, `frontmatter` and `bake`.

The steps are:
* `bake`: runs the page's [[Baked Sections|live content]] and keeps the result as plain text, without the markers.
* `links`: [[Link|wiki links]] and transclusions to a page in the share (or the page itself) are rewritten by the target's `link` function; a link to any other page becomes its text (its alias, or the page name), and a transclusion of anything outside the share is removed. Wiki link syntax inside code is left alone.
* `comments`: removes HTML comments (`<!-- ... -->`), both whole blocks and inline.
* `frontmatter`: keeps only `title`, `description` and `tags`; when nothing is left the page has no frontmatter block at all.

After the built-in steps the `share:transform` services run (see below), except for exempt pages and pages with `share.transform: false`.

## share.resolveSteps(name, text, target, override?)
Returns the `steps` table for a page: the `defaults` of the target, switched off for pages that are exempt, and for the steps `override` turns off. `override` is the page's `share.transform` value: `false` switches every step off, a table such as `{bake = false}` switches the listed steps off. It can only turn steps off, never on.

## share.isExempt(name, text)
Returns true for pages tagged `meta` or `meta/...`, such as library pages: they are published as they are apart from removing their `share.*` keys, with no step and no `share:transform` service applied.

## share.target(uri)
Returns the descriptor of the provider that serves a URI, found through the `share:target:<uri>` services, or `share.genericTarget` when none claims it.

## share.genericTarget
The descriptor used for locations no provider claims: all steps on, and links outside the page reduced to their text.

# Modes
The `share.mode` frontmatter key selects how a share behaves:
* `push`: write the local page to the remote when it changed locally. The page is transformed first (see [[Share#What gets published]]).
* `pull`: replace the local page with the remote when it changed remotely, asking first when there are local changes too.
* `sync`: both directions, see below.

Only `push` transforms the page. `pull` and `sync` copy the page as it is, with just the `share.*` keys removed.

Sharing never edits the page for bookkeeping: apart from taking in what a `pull` or `sync` brought over, a share leaves the page as it is. What this device last shared is kept on the device, not in the page, so a page that is shared from a second device for the first time may ask which version to keep.

## Sync
In `sync` mode the local page, the remote page and the content this device last shared decide what happens:
* Only local changes: the local page is written to the remote.
* Only remote changes: the remote content replaces the local page.
* Changes on both sides: the two versions are merged with [[API/space|space.mergeText]], using the content both sides agreed on at the last share as the common base. The merged text is written to the remote and the local page. If the texts overlap, the result contains conflict markers; you are told to resolve them and share again.
* Changes on both sides, but the texts can't be merged (a version already has conflict markers, or is too large): the remote version is saved as a copy named `<page>.conflicted-<hash>` and nothing is overwritten.
* This device can't tell which side changed (it has no record of the last share, and the page has no unchanged `share.hash` left from an older version): you are asked with a diff, see [[API/editor#editor.chooseVersion]]. You can take theirs, keep mine, or save theirs as a copy.

Sync writes to the remote are conditional where the transport supports it: they pass `{conditional = true}` to `net.writeURI`. When the remote changed in the meantime (the write returns `{conflict = true}`), the share is retried once from the new remote state; when it changed yet again, the share fails. Push writes are never conditional: the local page wins, whatever changed remotely. A push with nothing changed locally since this device last pushed doesn't touch the remote at all, and one with changes writes without reading the remote first. Only when this device has no record of the last push is the remote read, so what is already there isn't written again.

# Services
Share is extended through the [[API/service|service]] API.

## share:onboard
Offers a way to share a page for the first time; these are the options listed by {[Share: Page]}. Register one with `match` fields `name` and `description` (shown in the list). `run(data)` receives `{name, text, content}`: the page name, its text, and `content`, the text a push would send (transformed for a generic target, so a provider that uploads during onboarding doesn't publish comments or private frontmatter). It returns `{uri, mode}` to set up the frontmatter, or nil when cancelled. A `hash` in the result is ignored. {[Share: Page]} then shares the page as usual, which uploads it in `push` mode; a provider doesn't need to upload it itself.

```lua
service.define {
  selector = "share:onboard",
  match = {name = "My service", description = "Share this page to my service"},
  run = function(data)
    return {uri = "myservice:" .. data.name, mode = "push"}
  end,
}
```

## share:ensure
Called with `{uri}` before sharing in `push` or `sync` mode (a `push` without local changes skips it, since it touches no remote), to prepare a transport for a URI nothing handles yet, or to sign in before the first read or write, for example connecting to a SilverBullet space a page was shared to from another device, or signing in to a known space this device has no credential for yet. Register it with a `match` function that returns a table with `priority` when it recognizes the URI. The return value of `run` is informational: `share.ensureTransport` ignores it. When the URI does belong to the service but it can't prepare a transport (for example the user declines to connect), `run` should raise an error, so the share stops instead of falling back to another reader such as the generic `https:` one.

## share:target:<uri>
Describes how a location wants the pages published to it. A provider registers a service with a selector such as `share:target:myservice:*` (with a `match` that has a `priority`, or a function that returns one when it recognizes the URI), and `run({uri})` returns a descriptor table:
* `kind`: a name for the kind of location, for example `github`.
* `defaults`: the steps that are on by default, a table of booleans for `links`, `comments`, `frontmatter` and `bake`. The [[SilverBullet Share|SilverBullet space]] target has links and comments on and frontmatter and bake off, GitHub files, gists and everything else have all four on.
* `link(l)`: returns the text that replaces a wiki link or transclusion that points inside the share. `l` has `page` and `anchor` (the target, the anchor without `#`), `alias`, `text` (the alias, or the page name), `transclusion` (true for `![[...]]`), `fromUri` (the URI of the page being shared) and `toUri` (the URI of the target page, or nil for a link within the page itself).

## share:transform
Extends `share.transform` with your own step. Register a service with `match = {name = "...", order = n}`; `run({text, ctx})` returns the new text (`ctx` is described at [[#share.transform(text, ctx)]]). Services run after the built-in steps in ascending `order` (100 when not set) and are skipped for exempt pages and for pages with `share.transform: false`.

```lua
service.define {
  selector = "share:transform",
  match = {name = "Remove todos", order = 200},
  run = function(data)
    return data.text:gsub("TODO[^\n]*\n", "")
  end,
}
```

## net.readURI: and net.writeURI:
The actual transfer is done by [[API/net|net.readURI and net.writeURI]]. A provider registers services with selectors such as `net.readURI:myservice:*` and `net.writeURI:myservice:*`; `run(data)` receives the `uri` (and `content` for writes, plus any options passed to `net.writeURI`). A read returns the text, or nil when missing. When a write has `conditional` set and finds the remote changed since it was last read, it should return `{conflict = true}` instead of writing, so sync can retry. Without `conditional`, a write overwrites. See [[API/github]] and [[API/sbShare]] for implementations.
