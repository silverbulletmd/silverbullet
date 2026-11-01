#getting-started

Start with the section for the application you use. If you ask the [community for help](https://community.silverbullet.md/), include whether you use Desktop or a browser connected to Server, the version, what you expected and what happened.

# Desktop
For an error inside an open space, inspect the log in [[Workbench/Console]]. If it started after adding a script, style or library, review that change through the relevant Workbench tab.

If the local page is correct but another device has an older version, check the space’s **Sync** settings in the Desktop dashboard and confirm that the external Server is reachable. [[Desktop Sync]] explains the connection setup. If you do not use an external Server, there is no Desktop–Server sync to diagnose.

Check [[Desktop Updates]] for an available update. Before changing or replacing files to recover a space, preserve a copy and follow [[Guide/Storage and Recovery]]. Desktop stores the space in a local folder; the browser cache reset below does not repair those files.

# Server
If the Server cannot be reached, check that its process is running, then inspect its logs and any reverse-proxy logs; see [[Log]]. Verify the listening address and port in [[Install/Configuration]] and the setup in [[Install/Network and Internet]]. If the Server responds but access is denied, check the account and space access settings in the [[Dashboard]].

For errors after the editor opens, inspect [[Workbench/Console]] and the browser’s JavaScript console. The following browser options help isolate scripts, styles, plugs and offline-cache problems.

## Disable client features
Temporarily disable a feature by appending one of these options to the space URL, for example `http://localhost:3000/?disableSpaceLua=1`:

* `?disableSync=1` disables browser offline synchronization with the Server.
* `?disableSpaceLua=1` disables loading [[Space Lua]] scripts.
* `?disableSpaceStyle=1` disables loading [[Space Style]].
* `?disablePlugs=1` disables loading non-built-in [[Plugs]].

Combine options with `&`, for example `?disableSpaceLua=1&disableSpaceStyle=1`. Remove the options when you finish diagnosing the problem.

## Reset a browser client
If the problem is in the browser’s local cache, adding `?resetClient=1` to the space URL offers a full client reset. After confirmation, it clears browser storage, unregisters the service worker and reloads the client to synchronize again.

> **warning** Unsynchronized edits will be lost
> Check that the Server is accessible and preserve any edits that have not reached it before resetting the browser. This clears the browser’s copy, not the Server’s files.

## Server-side debugging
* `SB_HTTP_LOGGING`: enable HTTP request logging.
* `SB_LOG_PUSH`: ask clients to push their logs to the Server.

See [[Install/Configuration]] for configuration options and [[Guide/Storage and Recovery]] for restoring files or revision history.
