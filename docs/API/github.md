---
tags: api/space-lua
references:
- libraries/Library/Std/Infrastructure/Github.md
---

APIs and configuration of the [[^Library/Std/Infrastructure/Github]] integration, which reads and writes Github repository files and gists for [[Share]].

Signing in uses the `github` provider of [[API/auth|auth]], which runs the device flow of [[API/oauth|oauth.deviceFlow]]. The token is stored on the device only.

# Configuration
* `github.token`: a personal access token with repo and gist permissions. Used when set and there is no stored credential from signing in. It is not copied into the credential store, and when Github rejects it you are not asked to sign in instead: fix or remove the token.
* `github.clientId`: client ID of your own Github OAuth app (device flow enabled), used instead of the default one for signing in.
* `github.name` and `github.email`: author of commits made when sharing to repositories.

```lua
config.set("github.token", "your token")
config.set("github.clientId", "your client id")
```

The provider's headers hold only `Authorization`, since raw and download hosts reject others; API requests add `Accept` themselves.

# API
## github.request(url, method, body?)
Makes a Github API request with [[API/auth|auth.fetch]], signing in when needed (or using `github.token`). A rejected token from signing in is dropped and you sign in again, once. Returns the response.

Reads of Github content use `auth.fetch("github", url, options)` directly: they never sign in, and a rejected token is retried without credentials, so public content stays readable.
