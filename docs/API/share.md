---
tags: api/space-lua
references:
- libraries/Library/Std/Infrastructure/Share.md
- libraries/Library/Std/Infrastructure/Share Collections.md
- libraries/Library/Std/Infrastructure/Share Commands.md
---

APIs and extension points of [[Share]], which publishes a page to, pulls it from, or syncs it with an external location; see [[^Library/Std/Infrastructure/Share]] for the implementation, [[^Library/Std/Infrastructure/Share Collections]] for collections and [[^Library/Std/Infrastructure/Share Commands]] for the commands and the functions behind them (listing, web links, unsharing). The location is a [[URI]] kept in the page's `share.*` frontmatter.

# API
## share.sharePage(name?)
Shares a page according to its `share.*` frontmatter, the same as the `Share: Page` command. Without a name it shares the current page. Returns `true` when something was shared, `false` when there was nothing to do, and `nil` when the user already knows the outcome (a conflict, or a cancelled "Which version?" dialog). Errors with `Not configured` when the page has no `share.uri`.

## share.shareMany(names, opts?)
Shares the pages in order with `share.sharePage`. `opts.onProgress(index, total, name)` is called before each page, and `opts.cancelled()` is also checked before each page: when it returns true the run stops and the remaining pages are left out of the result. Returns a table keyed by page name with `{ok = true, result = ...}` or `{ok = false, error = ...}`; one failing page doesn't stop the others.

## share.status(name)
Tells offline whether a page changed locally since its last pull or sync, as its `share.hash` tells, without reading the remote. Returns `{uri, mode, state}` where `state` is `unchanged`, `localChanged`, or `unknown` when the page has no `share.hash` to compare with. A `push` page is always `unchecked`: push keeps no `share.hash`, so only its remote can tell (see [[#share.check(names)]]). Remembered per page on its text, as views ask often.

## share.check(names)
Reads the remotes of the given pages and compares them with the local pages and their `share.hash`. Never prompts, connects, signs in or writes: a remote that needs a sign-in is reported as an error. Returns a table keyed by page name with `{uri, mode, state}` where `state` is one of:
* `upToDate`: the remote has what would be sent.
* `missing`: nothing at the remote yet.
* `localChanged`: only the local page changed since the `share.hash` (the remote still matches it).
* `remoteChanged`: only the remote changed (the page still matches its `share.hash`).
* `bothChanged`: both changed.
* `differs`: they differ, and there is no `share.hash` to tell which side changed. Always the case for `push`, which keeps none (a `share.hash` left on a push page by older versions is ignored).
* `error`: reading failed, with the message in `error`.

## share.list()
Returns every page with a `share.uri`, sorted by name, as `{name, uri, mode, kind}`: `mode` is `push` when unset, `kind` is `library` for pages tagged `meta/library`, `repository` for `meta/repository` and `page` for everything else. Read from the index, so a page shared a moment ago appears once it is indexed. The [[Shared Pages]] view lists these.

## share.changedPages()
Returns the names of the pages `Share: All Changed` shares: the `sync` pages whose [[#share.status(name)]] is `localChanged`, and the `push` pages whose [[#share.check(names)]] is `differs` or `missing` (so their remotes are read; a push page whose check fails, say because its remote needs a sign-in, is left out for its own share to report). `pull` pages never.

## share.notifyShared(ok, ret)
Tells the user how a share went, from what `pcall(share.sharePage, ...)` returned: the error, "Share successful", "No changes", or nothing when `share.sharePage` returned `nil` (the user already knows). Used by `Share: Page` and the [[Shared Pages]] view.

## share.unshare(name?)
Stops sharing a page: removes its `share.*` keys. The copy at the remote stays. Without a name it unshares the current page in the editor.

## share.webUrl(uri)
Returns where `uri` can be viewed in a browser, or `nil`. Uses the `webUrl` of the [[#share:target:<uri>]] descriptor when it has one, and otherwise the URI itself when it is an `http://` or `https://` URI. Never raises: a failing `webUrl` gives `nil`.

## share.openRemote(uri)
Opens the web page of `uri` (see `share.webUrl`) in the browser, or tells the user there is none.

## share.copyLink(uri)
Copies the link to the web page of `uri` (see `share.webUrl`) to the clipboard, or tells the user there is none.

## share.collections()
Returns the names of the [[Share#Collections|collections]] configured in `share.collections`, sorted.

## share.collection(name)
Returns the collection as `{name, root, mode, members}`: `root` is the configured `uri` without trailing slashes, `mode` is always `push`, and `members` lists `{page, path, uri}` in the order `pages()` returned them, a page listed twice only once. `uri` is built by the `memberUri` of the root's [[#share:target:<uri>|target]]. Errors with `Unknown collection: <name>`, or `Collection <name>: ...` when the `mode` isn't `push`, `pages` or `path` fails, or two members go to the same member URI (on a gist, `Blog/Post` and `Blog-Post` both go to `Blog-Post.md`).

## share.checkCollection(name)
Reads the remote and compares it with what each member would send, like [[#share.check(names)]]. Where the target has a [[#net.listURI: and net.deleteURI:|listing]], one listing is read, and a member whose entry has a `hash` is compared by its [[#share.gitBlobSha(text)|git blob SHA]] without reading it; otherwise each member is read. Never prompts, connects, signs in or writes. Returns `{members, removed}`: `members` is keyed by page name with `{uri, state}`, `state` being `upToDate`, `missing`, `differs` or `error` (with the message in `error`), and `removed` lists the URIs of the listed files no member maps to (empty without a listing).

## share.publishCollection(name)
Publishes a collection, the same as `Share: Collection`: first prepares the root's transport with [[#share.ensureTransport(uri)]] (which may ask to connect or sign in), so the members' URIs are those of the root's [[#share:target:<uri>|target]] even when the transport was set up just now; then resolves the collection and transforms every member with the collection as the share set (afresh, so baked content is current) (see `members` at [[#share.transform(text, ctx)]]), lists the root (letting the provider sign in, `{signIn = true}`), writes the members whose text differs from the remote (by the listed `hash`, or else by reading the member's remote; one that can't be read is written) and offers the listed files no member maps to for removal with [[API/editor#editor.pickMany|editor.pickMany]], every item unticked. Only ticked files are deleted. Writes and deletes go in one call to a [[#share:writeBatch:<root>]] service when the root has one, and otherwise through `net.writeURI` and `net.deleteURI` one by one.

Returns `{written, unchanged, removed, failed, cancelled?}`: the pages written, the pages left alone, the URIs deleted, and `{page?, uri, error}` for each write or delete that failed. `cancelled` is true when the batch service reported that the user cancelled it (for example dismissing GitHub's commit message prompt): then nothing was written or deleted, and nothing counts as failed. A failed member's remote still differs, so the next publish tries it again. Errors before anything is written: a failing listing or a broken collection (see `share.collection`).

## share.changedCollections()
Returns the names of the collections `Share: All Changed` publishes: those with a member that is `missing` or `differs` by [[#share.checkCollection(name)]] (so their remotes are read). A collection whose check fails is left out, for its own publish to report.

## share.notifyPublished(name, ok, result)
Tells the user how a publish went, from what `pcall(share.publishCollection, name)` returned: `Published <name>: N written, M unchanged` (and `, K removed`), and the first failure as an error, or `Publish of <name> cancelled` when the user cancelled the batch.

## share.collectionFailure(f)
Returns one entry of the `failed` list of `share.publishCollection` as text: its page (or URI) and error.

## share.collectionLabel(root, uri)
Returns how a file under `root` is shown: its path below `root`, URL-decoded (`Old%20Page` reads `Old Page`; a path that doesn't decode, such as the gist file `50% off.md`, is shown as it is), or `uri` itself when it isn't under `root`.

## share.readRemote(uri)
Reads `uri` with `net.readURI` and returns its text without `share.*` keys, or `nil` when it is missing.

## share.remoteState(r)
The decision behind the states of [[#share.check(names)]] and [[#share.checkCollection(name)]]: returns `missing`, `upToDate`, `localChanged`, `remoteChanged`, `bothChanged` or `differs`. `r.remote` is `nil` when the remote is missing, `{text = ...}` for its text (as `share.readRemote` returns it) or `{sha = ...}` for its [[#share.gitBlobSha(text)|git blob SHA]]; `r.outgoing` is what would be sent. `r.hash` (optional) is the page's `share.hash`: without it a remote that isn't `upToDate` `differs`; with it, a remote matching the hash means only the local side changed, an outgoing text matching it means only the remote changed, and neither means both. The hash is compared with `r.remote.text` only.

## share.memo(copy?)
For Std pages that memoize per key (such as `share.status`): returns `memo(key, inputs, compute)`, which returns the result kept for `key` while `inputs` (a table of values, compared with `==`) are unchanged, and otherwise calls `compute()` and keeps its result. `copy(result)`, when given, makes what each call returns, so callers changing it leave the memo alone.

## share.gitBlobSha(text)
Returns the git blob SHA-1 of `text` (as UTF-8), the `hash` that `net.listURI` entries carry for GitHub, so a file can be compared without reading it.

## share.prepare(name, text)
Returns `{m, mode, outgoing}` for a page: its `share` frontmatter table, the mode (`push` when unset), and the text that goes to the remote. For `push` that is `text` run through [[#share.transform(text, ctx)]] with the steps resolved for the target of the URI; for `pull` and `sync` it is `text` with only the `share.*` keys removed. Errors with `Not configured` when the page has no `share.uri`.

## share.legacyHash(content)
Returns the 8-character hash kept in `share.hash` (the first 8 characters of the sha256 of the text without its `share.*` keys). `pull` and `sync` shares (and [[#share.install(uri, opts?)]]) write it for the text both sides agreed on at the last pull or sync, see [[#Modes]]. `push` never writes it. A hash written without quotes that YAML reads as a number (such as `83464e55`) still matches. The name is kept for compatibility.

## share.contentHash(content)
Alias of `share.legacyHash`.

## share.isManaged(name, text)
Returns true for pages tagged `meta/library` or `meta/repository` (installed libraries and repositories), whose remote is the source of truth: a `pull` of such a page overwrites local changes without asking when the page has no `share.hash` (when it has one, a page changed since asks first).

## share.install(uri, opts?)
Pulls `uri` into a page the way the [[Workbench/Libraries|Library Manager]] does: the page gets `share.uri`, `share.mode: pull` and the `share.hash` of the content. `opts` is a table with:
* `page`: the page to write; by default the `name` in the remote's frontmatter (an error when it has none).
* `installed`: the page installed from `uri` before, for an update. Nothing is written when the page already equals the remote, or the remote hasn't changed since it was installed (it matches the page's `share.hash`), so local edits stay until there is something new. When there is, local edits (the page no longer matches its `share.hash`) are only replaced once the user confirms; without a `share.hash` the remote replaces the page without asking. Without `installed`, an existing page is an error.
* `force`: with `installed`, writes the remote even when it hasn't changed, dropping local edits.

Returns `{page, files, changed}`: the page, the `files` list of the remote's frontmatter, and whether the page was written.

## share.ensureTransport(uri)
Makes sure a transport exists for a URI by invoking the first matching `share:ensure` service, if any. Called before sharing in `push` and `sync` mode. Errors from the service are passed on and stop the share.

## share.setFrontmatter(m, text)
Returns `text` with the `share.uri`, `share.mode`, `share.transform` and `share.hash` frontmatter keys set from the table `m` (`uri`, `mode`, `transform`, `hash`). Keys missing from `m` are left as they are; none are removed.

## share.cleanFrontmatter(text)
Returns `text` with all `share.*` keys removed (including a leftover `share.hash`), written as dotted keys or as a `share:` map.

## share.transform(text, ctx)
Returns what a push sends: `text` without its `share.*` keys, with the steps enabled in `ctx.steps` applied (see [[Share#What gets published]]). `ctx` is a table with:
* `page`: the name of the page; `bake` evaluates live content as this page.
* `uri`: the URI it is shared to.
* `target`: the descriptor of the provider, see [[#share:target:<uri>]].
* `members`: a table mapping the names of the pages that are shared together to their URIs, used to tell links inside the share from links outside it. `share.prepare` passes just the page itself, so links to other pages become text; a collection passes all its members.
* `steps`: a table of booleans for `links`, `comments`, `bake` and `extensions` (the `share:transform` services).

The `share.*` frontmatter keys are always removed; the rest of the frontmatter is kept as it is. The steps are:
* `bake`: runs the page's [[Baked Sections|live content]] and keeps the result as plain text, without the markers (text after a marker on its line stays).
* `links`: [[Link|wiki links]] and transclusions to a page in the share (or the page itself) are rewritten by the target's `link` function; a link to any other page becomes its text (its alias, or the page name), and a transclusion of anything outside the share is removed. Wiki link syntax inside code is left alone.
* `comments`: removes HTML comments (`<!-- ... -->`), both whole blocks and inline, except the markers of baked sections. A removed block leaves its neighbours as separate blocks.

After the built-in steps the `share:transform` services run (see below) when `extensions` is set.

## share.resolveSteps(name, text, target, override?)
Returns the `steps` table for a page: the `defaults` of the target, switched off for pages that are exempt, and for the steps `override` turns off. `override` is the page's `share.transform` value: `false` switches every step off, a table such as `{bake = false}` switches the listed steps off. It can only turn steps off, never on. `extensions` is on unless the page is exempt or `override` is `false`.

## share.isExempt(name, text)
Returns true for pages tagged `meta` or `meta/...`, such as library pages: they are published as they are apart from removing their `share.*` keys, with no step and no `share:transform` service applied.

## share.target(uri)
Returns the descriptor of the provider that serves a URI, found through the `share:target:<uri>` services, or `share.genericTarget` when none claims it.

## share.genericTarget
The descriptor used for locations no provider claims: all steps on, and links outside the page reduced to their text.

# Modes
The `share.mode` frontmatter key selects how a share behaves:
* `push`: write the local page to the remote when the remote differs. The page is transformed first (see [[Share#What gets published]]).
* `pull`: replace the local page with the remote when it changed remotely, asking first when there are local changes too.
* `sync`: both directions, see below.

Only `push` transforms the page. `pull` and `sync` copy the page as it is, with just the `share.*` keys removed.

Nothing is kept on the device: what was last agreed with the remote is in the page. `pull` and `sync` keep `share.hash`, the [[#share.legacyHash(content)|hash]] of the text both sides agreed on at the last pull or sync; after every pull or sync that agrees on a text with the remote, including one where both sides were already equal, it is set to that text's hash (only the frontmatter changes when the text is already the page's). Space sync carries it to your other devices with the page. `push` never edits the page: it compares with the remote instead.

## Push
A push reads the remote first (after [[#share:ensure]], which may sign in) and writes the transformed page when the remote differs or is missing; when the remote already has it, nothing is written. A transport that can't read is written to all the same. Push writes are never conditional: the local page wins, whatever changed remotely.

## Pull
A pull reads the remote and:
* The remote equals the page: nothing to do (`share.hash` is set if it doesn't match).
* The remote matches `share.hash`: only the page changed, so there is nothing to pull and the local changes stay.
* The page matches `share.hash`: only the remote changed, and it replaces the page.
* The page changed since `share.hash`: you are asked whether to overwrite your local changes.
* No `share.hash`: you are asked whether to overwrite the page with the remote version, except for [[#share.isManaged(name, text)|installed libraries and repositories]], which are overwritten.

## Sync
In `sync` mode the local page, the remote page and `share.hash` decide what happens:
* Both sides are equal: nothing is written (`share.hash` is set if it doesn't match).
* Only local changes (the remote still matches `share.hash`): the local page is written to the remote.
* Only remote changes (the page still matches `share.hash`): the remote content replaces the local page.
* Changes on both sides, or no `share.hash` to tell: you are asked with a diff, see [[API/editor#editor.chooseVersion]]. You can take theirs, keep mine, or save theirs as a copy named `<page>.conflicted-<hash>`.

Sync writes to the remote are conditional where the transport supports it: they pass `{conditional = true}` to `net.writeURI`. When the remote changed in the meantime (the write returns `{conflict = true}`), the share is retried once from the new remote state; when it changed yet again, the share fails.

# Services
Share is extended through the [[API/service|service]] API.

## share:onboard
Offers a way to share a page for the first time; these are the options listed by `Share: Page`. Register one with `match` fields `name` and `description` (shown in the list). `run(data)` receives `{name, text, content}`: the page name, its text, and `content`, the text a push would send (transformed for a generic target, so a provider that uploads during onboarding doesn't publish comments or `share.*` keys; `ctx.uri` is not set during this transform). When that transform fails, `Share: Page` reports the error and offers no providers. It returns `{uri, mode}` to set up the frontmatter, or nil when cancelled. A `hash` in the result is ignored. `Share: Page` then shares the page as usual, which uploads it in `push` mode; a provider doesn't need to upload it itself. When that first share fails, the `share.*` keys are taken out again, so the page stays unshared.

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
Called with `{uri}` before sharing in `push` or `sync` mode, before the remote is read, to prepare a transport for a URI nothing handles yet, or to sign in before the first read or write, for example connecting to a SilverBullet space a page was shared to from another device, or signing in to a known space this device has no credential for yet. Register it with a `match` function that returns a table with `priority` when it recognizes the URI. The return value of `run` is informational: `share.ensureTransport` ignores it. When the URI does belong to the service but it can't prepare a transport (for example the user declines to connect), `run` should raise an error, so the share stops instead of falling back to another reader such as the generic `https:` one.

## share:target:<uri>
Describes how a location wants the pages published to it. A provider registers a service with a selector such as `share:target:myservice:*` (with a `match` that has a `priority`, or a function that returns one when it recognizes the URI), and `run({uri})` returns a descriptor table:
* `kind`: a name for the kind of location, for example `github`.
* `defaults`: the steps that are on by default, a table of booleans for `links`, `comments` and `bake`. The [[SilverBullet Share|SilverBullet space]] target has links and comments on and bake off, GitHub files, gists and everything else have all three on.
* `webUrl(uri)` (optional): returns the address of the shared page in a browser, used by [[#share.webUrl(uri)]]. Without it, `http://` and `https://` URIs are their own web address and others have none. A gist file's is the gist page with an anchor to the file.
* `memberUri(root, path)` (optional): returns the URI of a collection member at `path` (a page name, or what the collection's `path` function returns) under `root`. It must match the URIs `net.listURI` returns for the root, or every member reads as missing and is offered for removal. Without it, `<root>/<path>.md`. SilverBullet spaces use `<root>/<encoded path>` (page URLs, without `.md`), GitHub `<root>/<encoded path>.md`, and gists `<root>/<path>.md` with every `/` in the path replaced by `-`.
* `link(l)`: returns the text that replaces a wiki link or transclusion that points inside the share. `l` has `page` and `anchor` (the target, the anchor without `#`), `alias`, `text` (the alias, or the page name), `transclusion` (true for `![[...]]`), `fromUri` (the URI of the page being shared) and `toUri` (the URI of the target page, or nil for a link within the page itself).

## share:transform
Extends `share.transform` with your own step. Register a service with `match = {name = "...", order = n}`; `run({text, ctx})` returns the new text (`ctx` is described at [[#share.transform(text, ctx)]]). Services run after the built-in steps in ascending `order` (100 when not set) and are skipped for exempt pages and for pages with `share.transform: false`. A service that returns `nil` leaves the text as it is; returning anything other than text is an error.

```lua
service.define {
  selector = "share:transform",
  match = {name = "Remove todos", order = 200},
  run = function(data)
    return data.text:gsub("TODO[^\n]*\n", "")
  end,
}
```

## share:writeBatch:<root>
Writes and deletes everything of one collection publish in a single call, for example as one commit. `share.publishCollection` invokes the best service matching `share:writeBatch:<root>` with `{root, writes, deletes}`: `writes` lists `{uri, content}`, `deletes` lists URIs. An error marks every write and delete of the call as failed. GitHub registers one that makes a single commit, asking for the commit message first. A service the user cancels returns `{cancelled = true}` (GitHub's does when the commit message is dismissed or empty): the publish then writes nothing and reports `cancelled`. Without such a service, `net.writeURI` and `net.deleteURI` are called per file, which applies to gists and SilverBullet spaces (GitHub has no `net.deleteURI`).

## net.listURI: and net.deleteURI:
Collections use [[API/net|net.listURI and net.deleteURI]]: a provider registers `net.listURI:myservice:*` returning `{uri, hash?}` for every file under `data.uri`, in the form its `memberUri` builds (`hash` a git blob SHA when it has one, see [[#share.gitBlobSha(text)]]), and `net.deleteURI:myservice:*` deleting `data.uri`. `share.publishCollection` lists with `{signIn = true}`, so the provider may sign in; `share.checkCollection` doesn't pass it, and the listing should fail rather than prompt. SilverBullet spaces list every page under the root (a root that is the whole space isn't listed, so nothing is offered for removal there), GitHub every `.md` file under the root folder (with blob SHAs), and gists every `.md` file of the gist. A target without a listing service (`net.listURI` returns `nil`) is written member by member, with nothing offered for removal.

## net.readURI: and net.writeURI:
The actual transfer is done by [[API/net|net.readURI and net.writeURI]]. A provider registers services with selectors such as `net.readURI:myservice:*` and `net.writeURI:myservice:*`; `run(data)` receives the `uri` (and `content` for writes, plus any options passed to `net.writeURI`). A read returns the text, or nil when missing. When a write has `conditional` set and finds the remote changed since it was last read, it should return `{conflict = true}` instead of writing, so sync can retry. Without `conditional`, a write overwrites. See [[API/github]] and [[API/sbShare]] for implementations.
