# Sync API

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

### sync.scheduleFileSync(path)
Actively schedules a file to be synced. Sync will happen by default too, but this prioritizes the file.

Example:
```lua
sync.scheduleFileSync("notes/important.md")
```

### sync.scheduleSpaceSync()
Schedules a sync without waiting for the usual sync interval.

Example:
```lua
local changes = sync.scheduleSpaceSync()
print("Number of changes synced: " .. changes)
