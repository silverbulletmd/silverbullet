---
tags: api/syscall
references:
- plug-api/syscalls/sync.ts
- client/plugos/syscalls/sync.ts
- client/spaces/sync.ts
---

The Sync API provides functions for interacting with the sync engine when the client runs in Sync mode.

<!--#lua spacelua.renderApiDocumentation("sync") -->
## sync.areFilesReadyToIndex

`sync.areFilesReadyToIndex(paths)`

For each file, whether indexing it now would read it locally or cheaply (true), or race the initial sync and expensively re-download it (false).

**Parameters:**

- `paths` (`string[]`) — Space-relative file paths.

**Returns:**

- `boolean[]` — Per-path readiness, in input order.

## sync.hasInitialSyncCompleted

`sync.hasInitialSyncCompleted()`

Checks whether the initial client synchronization has completed.

**Returns:**

- `boolean` — Whether initial sync is complete.

## sync.isEnabled

`sync.isEnabled()`

Whether client Sync is enabled. False when the service worker is off.

**Returns:**

- `boolean` — False when SB_DISABLE_SERVICE_WORKER is set or the browser has no service worker.

## sync.performFileSync

`sync.performFileSync(path, remoteLastModified?, remoteRevisionHash?)`

Prioritizes a file for immediate synchronization and waits for completion.

**Parameters:**

- `path` (`string`) — Space-relative file path.
- `remoteLastModified?` (`number`) — lastModified of the remote change event, used for echo suppression.
- `remoteRevisionHash?` (`string`) — Content revision the remote change event reported, which tells a same-millisecond change from an echo.

**Example:**

```lua
sync.performFileSync("notes/important.md")
```

## sync.performSpaceSync

`sync.performSpaceSync()`

Starts an immediate full-space synchronization and waits for completion.

**Returns:**

- `number` — Number of sync operations, or zero without an active worker.

**Example:**

```lua
local changes = sync.performSpaceSync()
```
<!--/lua-->

