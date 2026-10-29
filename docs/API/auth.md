---
tags: api/space-lua
references:
- libraries/Library/Std/Infrastructure/Auth.md
- client/plugos/syscalls/oauth.ts
---

APIs to store credentials for remote services and to turn them into HTTP headers; see [[^Library/Std/Infrastructure/Auth]] for the page that implements them.

Credentials live in the client-side store of the current device. They are never synced to the server or to other devices, and are stored encrypted when client encryption is enabled.

# Keys
A credential is stored under a key, either `provider` or `provider:target`, for example `github` or `sb:https://example.com/notes`. The part before the first colon names the provider that signs in and builds headers; the rest identifies what it signs in to.

# API
## auth.defineProvider(provider)
Registers an authentication provider. Fields:
* `id` _(required)_: the provider name, the part of the key before the colon.
* `connect(target)` _(required)_: signs in and returns the credential as a table, e.g. `{access_token = "..."}`. `target` is the part of the key after the colon, if any. Often implemented with [[API/oauth|oauth.deviceFlow]].
* `headers(cred)` _(required)_: returns a table of HTTP headers for a credential.
* `refresh(cred)`: returns a renewed credential. Without it, an expired credential means signing in again.
* `expired(cred)`: returns true when the credential must be renewed. Defaults to `cred.expires_at` (milliseconds) being within a minute of now.
* `configured(target)`: returns a credential from configuration, such as a personal access token, or nil. It is used when no credential is stored, is never stored itself, and while it returns one nothing signs in.

```lua
auth.defineProvider {
  id = "example",
  connect = function(target)
    local token = oauth.deviceFlow {
      deviceCodeUrl = target .. "/device/code",
      tokenUrl = target .. "/token",
      clientId = "my-client",
    }
    return {access_token = token.access_token}
  end,
  headers = function(cred)
    return {Authorization = "Bearer " .. cred.access_token}
  end,
}
```

## auth.fetch(key, url, options?, signIn?)
[[API/net|net.proxyFetch]] with the headers of the credential for a key added to `options.headers`. Returns the response.
* With `signIn` true it signs in when there is no credential, like `auth.headers`. A 401 for a stored credential (revoked or expired on the server) drops it, signs in again and repeats the request, once.
* Without, it never signs in, like `auth.optionalHeaders`. A 401 drops the stored credential and repeats the request once without credentials, so public content stays readable.

A configured credential that gets a 401 is not replaced by signing in, since only the user can fix it; without `signIn` the request is still repeated without it.

```lua
-- A write: signs in when needed
auth.fetch("github", "https://api.github.com/gists", {method = "POST", body = gist}, true)
-- A read: never signs in
auth.fetch("github", "https://api.github.com/gists/" .. id)
```

## auth.headers(key)
Returns the HTTP headers for a key. It signs in when there is no credential (showing whatever the provider's `connect` shows), renews an expired credential and signs in again if renewing fails, and stores the result. Errors from `connect` are passed on and nothing is stored.

```lua
net.proxyFetch("https://api.example.com/me", {headers = auth.headers("example:https://api.example.com")})
```

## auth.optionalHeaders(key)
Like `auth.headers`, but never signs in: returns the headers of the stored credential (renewed first if it expired), or nil when there is none or it can't be renewed. Use it for requests that work without signing in, such as reads of public content.

## auth.getCredential(key)
Returns the stored credential table, or nil. Besides what the provider returned it has `provider` and `createdAt` (milliseconds).

## auth.setCredential(key, value)
Stores a credential table under a key and returns it as stored, with `provider` and `createdAt` added.

## auth.deleteCredential(key)
Removes a credential, so the next `auth.headers` signs in again.

## auth.listKeys(prefix?)
Returns the stored keys in alphabetical order, optionally only those starting with `prefix`, e.g. `auth.listKeys("sb:")`.

## auth.splitKey(key)
Splits a key into provider and target: `auth.splitKey("sb:https://h/notes")` returns `"sb", "https://h/notes"`, and `auth.splitKey("github")` returns `"github", nil`.

## auth.list()
Returns a table per stored credential with `key`, `provider` and `createdAt`.

# Commands
* `Credentials: List` shows the stored credentials.
* `Credentials: Clear` clears one (or, with several stored, all of them at once), so you are asked to sign in again the next time it is needed.
