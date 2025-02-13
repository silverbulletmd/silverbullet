HTTP APIs.

### http.request(url, options?)
Performs a HTTP call, proxied via the server (to avoid CORS issues).

Options:
* `method`: GET, POST, PUT, DELETE (GET is default)
* `headers`: table with header -> value mappings
* `body`: either a string or table (which will be JSON stringified)

Returns:
* `ok`: boolean if the request went ok
* `status`: HTTP status code
* `headers`: HTTP headers
* `body`: for content types:
  * `text/*`: string
  * `application/json`: parsed JSON object
  * anything else: UInt8Array