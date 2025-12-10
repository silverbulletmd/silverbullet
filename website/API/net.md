#api/space-lua

Network-related APIs.

### net.proxyFetch(url, options?)
Performs a HTTP call, proxied via the server (to avoid CORS issues, see [[HTTP API]]).

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

## net.readURI(uri, options?)
Fetches the content of a [[URI]].

Options:
* `encoding` force an encoding for the result, e.g. `{encoding = "text/markdown"}`

## net.writeURI(uri, content)
Writes content to a specific [[URI|URI]].