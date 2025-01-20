The Shell API provides functions for running shell commands.

### shell.run(cmd, args)
Runs a shell command with the specified arguments.

Example:
```lua
local result = shell.run("ls", {"-la"})
print("Output: " .. result.stdout)
print("Errors: " .. result.stderr)
print("Exit code: " .. result.code)
``` 