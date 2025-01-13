These are Lua functions defined in the global namespace:

# Standard Lua
## print(...)
Prints to your log (browser or server log).

## assert(expr)
Asserts `expr` to be true otherwise raises an [[#error]]

## ipairs
## pairs
## unpack
## type
## tostring
## tonumber
## error(message)
Throw an error.

Example: `error("FAIL")`

## pcall
## xpcall
## setmetatable
## getmetatable
## rawset

# Space Lua specific
## tag(name)
Returns a given [[Objects#Tags]] as a query collection, to be queried using [[Space Lua/Lua Integrated Query]].

Example:

${query[[from tag("page") limit 1]]}