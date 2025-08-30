The Shell API provides functions for running shell commands and interacting with processes.

### shell.run(cmd, args, stdin?)
Runs a shell command and returns its output.

Parameters:
- `cmd`: The command to run
- `args`: Array of arguments to pass to the command
- `stdin`: stdin string (optional)

Returns an object with:
- `stdout`: The standard output of the command
- `stderr`: The standard error of the command
- `code`: The exit code of the command

Example:
```lua
local result = shell.run("ls", {"-l"})
print("Output:", result.stdout)
print("Error:", result.stderr)
print("Exit code:", result.code)

local result = shell.run("cat", {}, "hello")
print("Output:", result.stdout) -- "hello"
```