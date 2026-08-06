---
tags: api/syscall
references:
- plug-api/syscalls/sync.ts
- client/plugos/syscalls/sync.ts
- client/spaces/sync.ts
---

The Sync API provides functions for interacting with the sync engine when the client runs in Sync mode.

<!--#lua spacelua.renderApiDocumentation("sync") -->
## sync.hasInitialSyncCompleted

`sync.hasInitialSyncCompleted()`

Checks whether the initial client synchronization has completed.

**Returns:**

- `boolean` — Whether initial sync is complete.

## sync.performFileSync

`sync.performFileSync(path)`

Prioritizes a file for immediate synchronization and waits for completion.

**Parameters:**

- `path` (`string`) — Space-relative file path.

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

