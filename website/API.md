The server API is relatively small. The client primarily communicates with the server for file “CRUD” (Create, Read, Update, Delete) style operations.

Here’s an attempt to document this API:

* `GET /index.json` (when sent with an `Accept: application/json` request header): will return a full listing of all files in your space including metadata like when the file was last modified, as well as permissions. This is primarily for sync purposes with the client. A request sent without the mentioned `Accept` header will redirect to `/` (to better support authentication layers like [Authelia](https://www.authelia.com/)).
* `GET /*.*`: _Reads_ and returns the content of the file at the given path. This means that if you `GET /index.md` you will receive the content of your `index` page. The `GET` response will have a few additional SB-specific headers:
  * `X-Last-Modified` as a UNIX timestamp in ms (as coming from `Data.now()`)
  * `X-Permission`: either `rw` or `ro` which will change whether the editor opens in read-only or regular mode.
* `PUT /*.*`: The same as `GET` except that it takes the body of the request and _writes_ it to a file.
* `DELETE /*.*`: Again the same, except this will _delete_ the given file.
* `GET /.client/*`: Retrieve files implementing the client
* `GET /*` and `GET /`: Anything else (any path without a file extension) will serve the SilverBullet UI HTML.
