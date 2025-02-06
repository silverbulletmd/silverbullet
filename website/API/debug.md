# Debug API

The Debug API provides functions for debugging and resetting the application state.

## debug.resetClient()
Completely wipes the client state, including cached files and databases.

Example:
```lua
debug.resetClient()
print("Client state has been reset")
```

## debug.cleanup()
Wipes the entire state KV store and the entire space KV store.

Example:
```lua
debug.cleanup()
print("All KV stores have been wiped")
