---
tags: api/space-lua
references:
- libraries/Library/Std/Infrastructure/SilverBullet Share.md
---

Helpers behind sharing pages to another SilverBullet space; see [[^Library/Std/Infrastructure/SilverBullet Share]] and [[API/share]].

A shared page is addressed by a URI of the form `<space url>/<page name>`, for example `https://example.com/notes/Shared/Page`. Reads and writes use the other space's `.fs` API with a token obtained through the device flow, kept under the credential key `sb:<space url>` (see [[API/auth]]).

One `net.readURI:` / `net.writeURI:` service pair handles every space. Its `match` resolves the URI when it is dispatched, so it claims URIs of any space known at that moment (from `share.silverbullet.spaces` or a stored credential), including spaces configured after this page loaded. Its priority is above the generic `https:` reader.

Requests go through [[API/auth|auth.fetch]]. Reads never sign in: they send the stored credential if there is one and read anonymously otherwise. A read rejected with 401 drops the credential and is tried once more anonymously; when that is rejected too, it fails with `Not connected to <space>: share a page to it in push or sync mode to sign in`. A missing page reads as nil. Writes sign in when needed, and when a write is rejected with 401 the credential is dropped and you sign in again, once.

On a new device a space can be known (from `share.silverbullet.spaces`) without a usable credential on that device (none, or an expired one that can't be refreshed). Before a `push` or `sync` share, the `share:ensure` service then asks `Sign in to <space>?` and runs the device flow, so a private space is never read anonymously first (with a usable credential it does nothing); declining fails with `Not connected to <space>` and leaves the page and the remote alone. `pull` shares and `uri:` pages never ask: they read anonymously. For a URI of a space that is not known at all, `share:ensure` first finds the space root with `sbShare.findSpaceRoot` (for `http:` and `https:` URIs), asks `Connect to <space>?`, signs in and remembers the space.

Only sync writes are conditional (they pass `{conditional = true}` to `net.writeURI`): they send the ETag of the last read as `If-Match`, so a change made in the meantime makes the write return `{conflict = true}` and sync retries. Push writes never send `If-Match`: the local page replaces the remote one.

# Configuration
`share.silverbullet.spaces` is a list of space URLs shared to before, most recent first. It is offered when choosing a space and kept in the space's configuration, so it is the same on every device.

# API
## sbShare.pageUri(spaceUrl, pageName)
Builds the share URI of a page in a space: the space URL without trailing slashes, then the page name percent-encoded except for `/`, e.g. `sbShare.pageUri("https://h/notes/", "Café Plan")` is `https://h/notes/Caf%C3%A9%20Plan`.

## sbShare.resolve(uri)
Returns the space URL and page name a share URI points to, choosing the longest matching known space (one in `share.silverbullet.spaces` or with a stored credential on this device), or nil.

## sbShare.findSpaceRoot(url)
Finds the root of the SilverBullet space a URL belongs to by probing `.ping` at each path prefix, longest first (sending a stored credential, never signing in). Returns nil when it is not a SilverBullet space. Definitive misses (a 404, a 405, or a 200 without an `X-Server-Version` header) are remembered for the session; failures such as 401, 429, 5xx or network errors are not.
