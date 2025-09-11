Some notes on how things fit together.

# Client
The client is what you see when you open SilverBullet in a browser tab or window. It renders the UI, interacts with the user, runs [[Plugs]] and maintains the index. 90%+ of logic lives here.

The client relies on IndexedDB as a data store. It uses this data store primarily to keep the [[Objects|object index]]. In your browser’s database list, this database’s name will end with `_data`. This data store is _shared_ between tabs and windows (of the same browser).

The client interacts with the service worker and server primarily via the [[HTTP API]], which exposes CRUD-style operations on files.

# Service Worker
The [service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)’s role is to make SilverBullet offline capable. When enabled (it is enabled by default) it:
* Caches and serves the SilverBullet client code
* [[Sync|Syncs]] files with a local database
* Implements the [[HTTP API]], but handles it locally (where appropriate)

It does this by intercepting HTTP calls coming from the client aimed at the server.

The service worker embeds a [[Sync]] engine, that based on configuration constantly keeps a local copy of your files in sync with the server. To make the sync status visible, it emits events to the Client.

For debugging purposes you can disable the service worker by adding `?enableSW=0` to your URL. This disabling is persistent, to re-enable it use `?enableSW=1`.

# Server
The server has only three jobs:

* Handle authentication
* Serve the (static) client code
* Implement the [[HTTP API]], which mainly means listing, reading, writing and deleting files, and executing shell commands.

Note that all indexing, querying etc. happens in the client. The server effectively acts as a file store.

