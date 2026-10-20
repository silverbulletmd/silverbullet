---
tags: api/space-lua
references:
- libraries/Library/Std/Infrastructure/Share.md
---

APIs and extension points of [[Share]], which publishes a page to, pulls it from, or syncs it with an external location; see [[^Library/Std/Infrastructure/Share]] for the implementation. The location is a [[URI]] kept in the page's `share.*` frontmatter.

# API
## share.sharePage(name?)
Shares a page according to its `share.*` frontmatter, the same as the {[Share: Page]} command. Without a name it shares the current page. Returns `true` when something was shared, `false` when there was nothing to do, and `nil` when the user was already notified of the outcome (a conflict). Errors with `Not configured` when the page has no `share.uri`.

## share.contentHash(content)
Returns the 8-character hash used for `share.hash`. Frontmatter keys `share.uri`, `share.hash` and `share.mode` are ignored, so updating them never counts as a change.

## share.ensureTransport(uri)
Makes sure a transport exists for a URI by invoking the first matching `share:ensure` service, if any. Called before sharing in `push` and `sync` mode. Errors from the service are passed on and stop the share.

## share.setFrontmatter(m, text)
Returns `text` with the `share.uri`, `share.hash` and `share.mode` frontmatter keys set from the table `m` (`uri`, `hash`, `mode`). Keys missing from `m` are left as they are.

## share.cleanFrontmatter(text)
Returns `text` with those three keys removed.

# Modes
The `share.mode` frontmatter key selects how a share behaves:
* `push`: write the local page to the remote when it changed locally.
* `pull`: replace the local page with the remote when it changed remotely, asking first when there are local changes too.
* `sync`: both directions, see below.

## Sync
In `sync` mode the hashes of the local page, the remote page and the last shared state (`share.hash`) decide what happens:
* Only local changes: the local page is written to the remote.
* Only remote changes: the remote content replaces the local page.
* Changes on both sides: the two versions are merged with [[API/space|space.mergeText]], using the content both sides agreed on at the last share (kept on this device only) as the common base. The merged text is written to the remote and the local page. If the texts overlap, the result contains conflict markers; you are told to resolve them and share again.
* Changes on both sides, but no base is known or the texts can't be merged (a version already has conflict markers, or is too large): the remote version is saved as a copy named `<page>.conflicted-<hash>` and nothing is overwritten.

The base is only used while its hash is still the page's `share.hash`. A base this device recorded before the page was shared from another device is ignored, so the merge never uses the wrong ancestor; you get a conflict copy instead.

Sync writes to the remote are conditional where the transport supports it: they pass `{conditional = true}` to `net.writeURI`. When the remote changed in the meantime (the write returns `{conflict = true}`), the share is retried once from the new remote state; when it changed yet again, the share fails. Push writes are never conditional: the local page wins, whatever changed remotely.

# Services
Share is extended through the [[API/service|service]] API.

## share:onboard
Offers a way to share a page for the first time; these are the options listed by {[Share: Page]}. Register one with `match` fields `name` and `description` (shown in the list). `run(data)` receives `{name, text}` (the page name and text) and returns `{uri, mode}` (plus `hash`, see below) to set up the frontmatter, or nil when cancelled. {[Share: Page]} then shares the page as usual. Without a `hash` that first share uploads the page in `push` mode. A provider that already uploaded it (for example because creating the remote yields the URI) returns `hash = share.contentHash(data.text)`, so there is nothing left to push.

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

## net.readURI: and net.writeURI:
The actual transfer is done by [[API/net|net.readURI and net.writeURI]]. A provider registers services with selectors such as `net.readURI:myservice:*` and `net.writeURI:myservice:*`; `run(data)` receives the `uri` (and `content` for writes, plus any options passed to `net.writeURI`). A read returns the text, or nil when missing. When a write has `conditional` set and finds the remote changed since it was last read, it should return `{conflict = true}` instead of writing, so sync can retry. Without `conditional`, a write overwrites. See [[API/github]] and [[API/sbShare]] for implementations.
