---
tags: api/syscall
references:
- plug-api/syscalls/shell.ts
- client/plugos/syscalls/shell.ts
---

The Shell API provides functions for running shell commands and interacting with processes.

<!--#lua spacelua.renderApiDocumentation("shell") -->
## shell.run

`shell.run(command, arguments, stdin?)`

Runs a shell command on the server and returns its output.

**Parameters:**

- `command` (`string`) — Executable name.
- `arguments` (`table`) — Command arguments.
- `stdin?` (`string`) — Text supplied on standard input.

**Returns:**

- `table` — stdout, stderr, and numeric exit code.

**Examples:**

```lua
local result = shell.run("ls", {"-l"})
print(result.stdout)
```

```lua
local result = shell.run("cat", {}, "hello")
print(result.stdout)
```
<!--/lua-->

