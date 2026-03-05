The server API is relatively small. The client primarily communicates with the server for file “CRUD” (Create, Read, Update, Delete) style operations.

All API requests from the client will always set the `X-Sync-Mode` request header set to `true`. The server _will_ use this fact to distinguish between requests coming from the client and regular e.g. `GET` requests from the browser (through navigation) and redirect appropriately (for instance to the UI URL associated with a specific `.md` file).

# Authentication
When authentication is enabled, most endpoints require a valid session cookie (JWT) or a Bearer token. The following paths are excluded from auth: `/service_worker.js`, `/.client/*`, `/.auth`, `/.ping`.

* `GET /.auth`: Serves the login page. Returns 403 if authentication is not enabled.
* `POST /.auth`: Authenticates a user. Expects form fields: `username`, `password`, `rememberMe` (optional), `from` (optional redirect path). Returns JSON `{"status":"ok","redirect":"..."}` on success or `{"status":"error","error":"..."}` on failure. Implements lockout after repeated failed attempts.
* `GET /.logout`: Clears authentication cookies and redirects to `/.auth`.
* **Bearer token**: When [[Install/Configuration#Authentication|SB_AUTH_TOKEN]] is set, requests can authenticate via the `Authorization: Bearer <token>` header instead of cookies.

# File system
The space file system is exposed under the `/.fs` prefix:

* `GET /.fs` will return a full listing of all files in your space including metadata like when the file was last modified, as well as permissions in JSON format. This is primarily used for sync purposes with the client.
* `GET /.fs/*`: _Reads_ and returns the content of the file at the given path. This means that if you `GET /.fs/index.md` you will receive the content of your `index` page. If the optional `X-Get-Meta` _request header_ is set, the server does not _need to_ return the body of the file (but it can). The `GET` _response_ will have a few additional SB-specific headers:
  * (optional) `X-Last-Modified` the last modified time of the file as a UNIX timestamp in ms since the epoch (as coming from `Data.now()`). This timestamp _has_ to match the `lastModified` listed for this file in `/.fs` otherwise syncing issues may occur. When this header is missing, frequent polling-based sync will be disabled for this file.
  * (optional) `X-Created` the created time of the file as a UNIX timestamp in ms since the epoch (as coming from `Data.now()`).
  * (optional) `X-Permission`: either `rw` or `ro` which will change whether the editor opens in read-only or edit mode. When missing, `ro` is assumed.
  * (optional) `X-Content-Length`: which will be the same as `Content-Length` except if the request was sent with a `X-Get-Meta` header and the body is not returned (then `Content-Length` will be `0` and `X-Content-Length` will be the size of the file)
* `PUT /.fs/*`: The same as `GET` except that it takes the body of the request and _writes_ it to a file.
* `DELETE /.fs/*`: Again the same, except this will _delete_ the given file.

# RPC
Some functionality is exposed as RPC-style calls

* `GET /.ping`: Returns 200 with body `OK` if the server is available.
* `POST /.shell`: Run a shell command on the server side and return the result.
* `POST /.logs`: Accepts a JSON array of log entry objects with fields `source`, `level`, `message`, and `timestamp`. The server logs these with the client's IP. Returns `OK`.
* `* /.proxy/<host[:port]>/path`: Proxy an HTTP request to avoid CORS issues.
  * Blocked in read-only mode (returns 405).
  * The URI does not include a scheme — it is auto-detected: `http://` is used for `localhost`, `127.0.0.1`, bare IP addresses, and `host.docker.internal`; `https://` is used for everything else.
  * Request headers prefixed with `X-Proxy-Header-` have the prefix stripped and are forwarded to the upstream server.
  * Upstream response headers are returned with an `x-proxy-header-` prefix.
  * The `x-proxy-status-code` header contains the actual upstream HTTP status code; the proxy response itself always returns 200 to avoid interference.

# Client
* `GET /.config`: Retrieve client configuration, JSON with the following keys:
  * `readOnly`: Run the client in read-only mode
  * `spaceFolderPath`: Path of the space (used to prefix client database names to support switching space folders)
  * `indexPage`: name of the index page
  * `logPush`: whether the client should push logs to the server via `/.logs`
  * `enableClientEncryption`: true when authentication is enabled, offering client-side encryption as an option
* `GET /.client/*`: Retrieve files implementing the client
* `GET /.client/manifest.json`: Dynamically generated PWA manifest containing the space name and description (not served from the static bundle).
* `GET /*` (every other path) will serve the HTML of the SilverBullet UI
