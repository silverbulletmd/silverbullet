#api/syscall

The Sync API provides functions for interacting with the sync engine when the client runs in Sync mode.

## Sync Operations

### sync.isSyncing()
Checks if a sync is currently in progress.

Example:
```lua
if sync.isSyncing() then
    print("Sync in progress...")
end
```

### sync.hasInitialSyncCompleted()
Checks if an initial sync has completed.

Example:
```lua
if sync.hasInitialSyncCompleted() then
    print("Initial sync completed")
else
    print("Waiting for initial sync...")
end
```

### sync.performFileSync(path)
Immediately synchronizes a file with the server. Returns once the synchronization has completed.

Example:
```lua
sync.performFileSync("notes/important.md")
```

### sync.performSpaceSync()
Immediately triggers a full space sync. Returns `-1` if a sync was already ongoing, or the number of sync operations performed.

Example:
```lua
local changes = sync.scheduleSpaceSync()
print("Number of changes synced: " .. changes)
```