---
tags: api/syscall
references:
- client/plugos/syscalls/oauth.ts
- client/auth/device_flow.ts
---

The `oauth` namespace runs OAuth 2.0 sign-in flows; it is what [[API/auth|auth]] providers typically call from their `connect` function.

## Errors

`oauth.deviceFlow` raises an error whose message starts with one of these prefixes, so callers can tell the outcomes apart:

* `cancelled:` the user closed the code dialog.
* `expired:` the device code expired before it was approved.
* `denied:` the user (or the server) denied the request.
* `failed:` anything else, such as a network error or an unexpected response. The text after the prefix is the underlying message; an OAuth error code from the server (for example `unauthorized_client`) appears in it.

```lua
local ok, err = pcall(oauth.deviceFlow, opts)
if not ok and tostring(err):find("cancelled:", 1, true) then
  return nil
end
```

<!--#lua spacelua.renderApiDocumentation("oauth") -->
## oauth.deviceFlow

`oauth.deviceFlow(opts)`

Runs an OAuth 2.0 device authorization flow (RFC 8628). Shows a modal with a code for the user to enter, polls until approved, and returns the raw token response. Errors start with one of `cancelled:`, `expired:`, `denied:` or `failed:`.

**Parameters:**

- `opts` (`table`) — Table with `deviceCodeUrl`, `tokenUrl`, `clientId`, and optionally `scope` and `deviceName`.

**Returns:**

- Value — The token response as a table.

**Example:**

```lua
local token = oauth.deviceFlow {
  deviceCodeUrl = "https://github.com/login/device/code",
  tokenUrl = "https://github.com/login/oauth/access_token",
  clientId = "my-client-id",
  scope = "repo gist",
}
```
<!--/lua-->
