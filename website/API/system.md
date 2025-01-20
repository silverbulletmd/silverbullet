# System API

The System API provides system-level functions for interacting with the SilverBullet environment.

## Function Operations

### system.invoke_function(name, ...)
Invokes a plug function by name.

Example:
```lua
-- Invoke a function from a plug
system.invoke_function("myplug.process_data", "input", 123)
```

### system.invoke_command(name, args)
Invokes a client command by name.

Example:
```lua
system.invoke_command("editor.save", {})
```

### system.invoke_space_function(name, ...)
Invokes a space function by name.

Example:
```lua
local result = system.invoke_space_function("custom_function", "arg1", "arg2")
print("Function result:", result)
```

## System Information

### system.list_commands()
Lists all available commands.

Example:
```lua
local commands = system.list_commands()
for name, def in pairs(commands) do
    print(name .. ": " .. def.description)
end
```

### system.list_syscalls()
Lists all available syscalls.

Example:
```lua
local syscalls = system.list_syscalls()
for _, syscall in ipairs(syscalls) do
    print(syscall.name)
end
```

### system.get_env()
Returns the runtime environment ("server", "client", or undefined for hybrid).

Example:
```lua
local env = system.get_env()
print("Running in environment: " .. (env or "hybrid"))
```

### system.get_mode()
Returns the current mode of the system ("ro" or "rw").

Example:
```lua
local mode = system.get_mode()
print("System mode: " .. mode)
```

### system.get_version()
Returns the SilverBullet version.

Example:
```lua
local version = system.get_version()
print("SilverBullet version: " .. version)
```

## Configuration

### system.get_space_config(key, default_value)
Loads space configuration values.

Example:
```lua
-- Get specific config value
local value = system.get_space_config("theme", "light")

-- Get all config values
local config = system.get_space_config()
for key, value in pairs(config) do
    print(key .. ": " .. value)
end
```

### system.reload_config()
Triggers an explicit reload of the configuration.

Example:
```lua
local new_config = system.reload_config()
print("Configuration reloaded")
```

### system.reload_plugs()
Triggers a reload of all plugs.

Example:
```lua
system.reload_plugs()
print("All plugs reloaded")
``` 