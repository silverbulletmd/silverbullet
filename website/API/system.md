# System API

The System API provides system-level functions for interacting with the SilverBullet environment.

## Function Operations

### system.invokeFunction(name, ...)
Invokes a plug function by name.

Example:
```lua
-- Invoke a function from a plug
system.invokeFunction("myplug.processData", "input", 123)
```

### system.invokeCommand(name, args)
Invokes a client command by name.

Example:
```lua
system.invokeCommand("editor.save", {})
```

### system.invokeSpaceFunction(name, ...)
Invokes a space function by name.

Example:
```lua
local result = system.invokeSpaceFunction("customFunction", "arg1", "arg2")
print("Function result:", result)
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

### system.getEnv()
Returns the runtime environment ("server", "client", or undefined for hybrid).

Example:
```lua
local env = system.getEnv()
print("Running in environment: " .. (env or "hybrid"))
```

### system.getMode()
Returns the current mode of the system ("ro" or "rw").

Example:
```lua
local mode = system.getMode()
print("System mode: " .. mode)
```

### system.getVersion()
Returns the SilverBullet version.

Example:
```lua
local version = system.getVersion()
print("SilverBullet version: " .. version)
```

## Configuration

### system.getSpaceConfig(key, defaultValue)
Loads space configuration values.

Example:
```lua
-- Get specific config value
local value = system.getSpaceConfig("theme", "light")

-- Get all config values
local config = system.getSpaceConfig()
for key, value in pairs(config) do
    print(key .. ": " .. value)
end
```

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
