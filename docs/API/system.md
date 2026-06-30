---
tags: api/syscall
references:
- plug-api/syscalls/system.ts
- client/plugos/syscalls/system.ts
- plugs/editor/system.ts
---

The System API provides system-level functions for interacting with the SilverBullet environment.

## Function Operations

### system.invokeFunction(name, ...)
Invokes a plug function by name.

Example:
```lua
-- Invoke a function from a plug
system.invokeFunction("myplug.processData", "input", 123)
```

## System Information

### system.listCommands()
Lists all available commands.

Example:
```lua
local commands = system.listCommands()
for name, def in pairs(commands) do
    print(name .. ": " .. def.description)
end
```

### system.listSyscalls()
Lists all available syscalls.

Example:
```lua
local syscalls = system.listSyscalls()
for _, syscall in ipairs(syscalls) do
    print(syscall.name)
end
```

### system.getMode()
Returns the current mode of the system ("ro" or "rw").

Example:
```lua
local mode = system.getMode()
print("System mode: " .. mode)
```

### system.getURLPrefix()
Returns the prefix set by [[Install/Configuration|SB_URL_PREFIX]] or "/" if the variable isn't set

Example:
```lua
local prefix = system.getURLPrefix()
print("Prefix: " .. prefix)
```

### system.getVersion()
Returns the SilverBullet version.

Example:
```lua
local version = system.getVersion()
print("SilverBullet version: " .. version)
```

## Configuration

### system.reloadConfig()
Triggers an explicit reload of the configuration.

Example:
```lua
system.reloadConfig()
print("Configuration reloaded")
```

### system.reloadPlugs()
Triggers a reload of all plugs.

Example:
```lua
system.reloadPlugs()
print("All plugs reloaded")
```

### system.reboot()
Makes edited-on-disk state live and resolves only once the client is ready again. Useful for scripts, the `sb` CLI, and external tooling that change space files on disk and need a single "reboot to ready" call.

It mirrors the **System: Reload** command: it saves the currently-open editor buffer first, then flushes any latent on-disk changes into the index queue (via snapshot detection — not a full reindex), waits for indexing to finish, and finally re-applies configuration, scripts, and styles. Because the buffer is saved first, a raw on-disk edit to the *currently-open* page can be overwritten by the in-memory buffer; edit the open page through the editor (or navigate away) rather than on disk if that matters.


### system.wipeClient(logout?)
Completely wipes the client state, including cached files, service worker and databases.

Parameters:
- `logout`: Optional boolean to also log out the user

Example:
```lua
system.wipeClient(true)  -- Wipe client and log out
print("Client state has been reset")
```
