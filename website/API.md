The server API is relatively small. The client primarily communicates with the server for file “CRUD” (Create, Read, Update, Delete) style operations.

All API requests from the client will always have the `X-Sync-Mode` header set to `true`. The server may use this fact to distinguish between requests coming from the client and regular e.g. `GET` requests from the browser (through navigation) and redirect appropriately (for instance to the UI URL associated with a specific `.md` file).

The API:

* `GET /index.json` will return a full listing of all files in your space including metadata like when the file was last modified, as well as permissions. This is primarily used for sync purposes with the client.
* `GET /*.*`: _Reads_ and returns the content of the file at the given path. This means that if you `GET /index.md` you will receive the content of your `index` page. If the the optional `X-Get-Meta` _request header_ is set, the server does not _need to_ return the body of the file (but it can). The `GET` _response_ will have a few additional SB-specific headers:
  * `X-Last-Modified` as a UNIX timestamp in ms (as coming from `Data.now()`)
  * `X-Permission`: either `rw` or `ro` which will change whether the editor opens in read-only or regular mode.
  * (optional) `X-Content-Length`: which will be the same as `Content-Length` except if the request was sent with a `X-Get-Meta` header and the body is not returned (then `Content-Length` will be `0` and `X-Content-Length` will be the size of the file)
* `PUT /*.*`: The same as `GET` except that it takes the body of the request and _writes_ it to a file.
* `DELETE /*.*`: Again the same, except this will _delete_ the given file.
* `GET /.client/*`: Retrieve files implementing the client
* `GET /*` and `GET /`: Anything else (any path without a file extension) will serve the SilverBullet UI HTML.
