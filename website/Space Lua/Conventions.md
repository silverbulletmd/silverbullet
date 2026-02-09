#maturity/beta

Some coding conventions for [[Space Lua]]. Work in progress.

# Indentation
Use 2 spaces for indentation.

# Variable naming
For variables and methods alike use camelCasing as opposed to snake_case. That is: `myVariable` and `myFunction` instead of `my_variable` and `my_function`.

# Name spacing
Since Space Lua has a single global namespace across your entire space, it is good practice to manually namespace functions using the following pattern:

```lua
-- This initializes the stuff variable with an empty table if it's not already defined
stuff = stuff or {}

function stuff.adder(a, b)
  return a + b
end
```

And to use `local` if you don’t need to access outside your code block:

```lua
local myVariable

local function myFunction()
  
end
```

## Use singular top-level namespaces for APIs
Such as [[API/widget]], [[API/tag]].

## Use plural namespaces for collections
Such as [[^Library/Std/Widgets/Widgets|widgets]].

# API naming conventions
## *.define
This is a common Space Lua API naming convention used to define new entities of some type globally. Such APIs typically take a single table with arguments as an argument.

Internally, these APIs typically update the [[API/config]] as a side effect, which is then read elsewhere.

Examples:
* [[API/tag#tag.define(spec)]]
* [[API/taskState#taskState.define(def)]]
* [[API/config#config.define(key, schema)]]
* [[API/slashCommand#slashCommand.define(spec)]]
* [[^Library/Std/APIs/Command#command.define(commandDef)]]

## *.new
These like constructors for objects and do not have side effects.

Examples:

[[API/widget#widget.new(spec)]]

