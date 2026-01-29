Running into trouble? Sorry to hear it. Let’s figure this out.

Here are some things you can try when things don’t work, if you’re still stuck — ask the [community for help](https://community.silverbullet.md/).

The starting point is always [[Log|Logs]] to see if you see anything suspicious.

# Disable features
Depending on the situation you may (temporarily) disable various client features by appending any of the following to any SilverBullet URL (e.g. `http://localhost:3000/?disableSpaceLua=1`):
* `?disableSync=1` disables synchronization with the server
* `?disableSpaceLua=1` disables loading of all [[Space Lua]] scripts
* `?disableSpaceStyle=1` disables loading of all [[Space Style]]
* `?disablePlugs=1` disables loading of all non built-in [[Plugs]]

# Client reset
If all else fails, you may try to perform a full client reset, simply add `?resetClient=1` to any SilverBullet URL.

This will do the following:
1. Confirm you want to perform a full client reset
2. Wipe all data stored locally in your browser (IndexedDB, unregister the service worker)
3. Reload the client initiating a full resync
