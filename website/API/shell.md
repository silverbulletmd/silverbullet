The Shell API provides functions for running shell commands and interacting with processes.

### shell.run(cmd, args)
Runs a shell command and returns its output.

Parameters:
- `cmd`: The command to run
- `args`: Array of arguments to pass to the command

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
```

### shell.spawn(cmd, args)
Runs a shell command with streaming I/O, allowing interaction with the process.

Parameters:
- `cmd`: The command to run
- `args`: Array of arguments to pass to the command

Returns a ShellStream object with methods:
- `send(data)`: Send data to the process stdin
- `kill(signal)`: Send a signal to the process
- `close()`: Close the connection

Example:
```lua
local stream = shell.spawn("cat", {})
stream.send("Hello\n")
stream.close()
``` 