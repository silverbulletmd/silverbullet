# Sync API

The Sync API provides functions for interacting with the sync engine when the client runs in Sync mode.

## Sync Operations

### sync.is_syncing()
Checks if a sync is currently in progress.

Example:
```lua
if sync.is_syncing() then
    print("Sync in progress...")
end
```

### sync.has_initial_sync_completed()
Checks if an initial sync has completed.

Example:
```lua
if sync.has_initial_sync_completed() then
    print("Initial sync completed")
else
    print("Waiting for initial sync...")
end
```

### sync.schedule_file_sync(path)
Actively schedules a file to be synced. Sync will happen by default too, but this prioritizes the file.

Example:
```lua
sync.schedule_file_sync("notes/important.md")
```

### sync.schedule_space_sync()
Schedules a sync without waiting for the usual sync interval.

Example:
```lua
local changes = sync.schedule_space_sync()
print("Number of changes synced: " .. changes)
``` 