#getting-started

Running into trouble? Sorry to hear it. Let's figure this out.

Here are some things you can try when things don't work. If you're still stuck — ask the [community for help](https://community.silverbullet.md/).

The starting point is always [[Log|Logs]] to see if you see anything suspicious.

# Disable features
Depending on the situation you may (temporarily) disable various client features by appending any of the following to any SilverBullet URL (e.g. `http://localhost:3000/?disableSpaceLua=1`):

* `?disableSync=1` disables synchronization with the server
* `?disableSpaceLua=1` disables loading of all [[Space Lua]] scripts
* `?disableSpaceStyle=1` disables loading of all [[Space Style]]
* `?disablePlugs=1` disables loading of all non built-in [[Plugs]]

These can be combined: `?disableSpaceLua=1&disableSpaceStyle=1`

# Client reset
If all else fails, you can perform a full client reset by adding `?resetClient=1` to any SilverBullet URL.

This will:
1. Confirm you want to perform a full client reset
2. Wipe all data stored locally in your browser (IndexedDB, unregister the service worker)
3. Reload the client, initiating a full resync

> **warning** Warning
> A client reset wipes your local cache. Any unsynced local changes will be lost. Make sure your server is accessible before resetting, so the client can resync.

# Server-side debugging
* `SB_HTTP_LOGGING`: Set this environment variable to enable HTTP request logging
* `SB_LOG_PUSH`: Set this to ask clients to push their logs to the server

See [[Install/Configuration]] for all configuration options.
