---
tags: api/space-lua
references:
- client/space_lua/stdlib/js.ts
---

The `js` namespace provides JavaScript interoperability, including dynamic module imports, Lua/JavaScript value conversion, and asynchronous iterable support.

`js.importFromSpace` resolves a space-relative file path to the current space's same-origin `/.fs` URL. This lets a library import a JavaScript module shipped as a [[Frontmatter#files]] asset without constructing a deployment-specific base URL. A leading slash is optional, and a sole `default` export is unwrapped like `js.import`.

<!--#lua spacelua.renderApiDocumentation("js") -->
## js.eachIterable

`js.eachIterable(iterable)`

Creates a Lua iterator over a JavaScript async iterable.

**Parameters:**

- `iterable` (`userdata`) — JavaScript async iterable.

**Returns:**

- `function` — Iterator yielding successive JavaScript values.

**Example:**

```lua
for value in js.eachIterable(someJsAsyncIterable) do
  print(value)
end
```

## js.import

`js.import(url)`

Dynamically imports a JavaScript module from a URL.

**Parameters:**

- `url` (`string`) — Module URL.

**Returns:**

- `userdata` — Imported module, with a sole default export unwrapped.

**Example:**

```lua
local lib = js.import("https://esm.sh/lodash@4.17.21")
```

## js.importFromSpace

`js.importFromSpace(path)`

Imports a JavaScript module from a file in the current space.

**Parameters:**

- `path` (`string`) — Space-relative module path, with an optional leading slash.

**Returns:**

- `userdata` — Imported module, with a sole default export unwrapped.

**Example:**

```lua
local acme = js.importFromSpace("Library/acme/acme.js")
```

## js.log

`js.log(...)`

Logs values to the JavaScript console.

**Parameters:**

- `...` — Values to log.

**Example:**

```lua
js.log("User data:", {name = "Ada"})
```

## js.new

`js.new(constructor, ...): userdata`

Creates an instance of a JavaScript class.

**Parameters:**

- `constructor` (`userdata`) — JavaScript constructor function.
- `...` — Constructor arguments converted to JavaScript values.

**Returns:**

- `userdata` — New JavaScript instance.

**Example:**

```lua
local value = js.new(js.window.Date, "2024-03-14")
```

## js.stringify

`js.stringify(value)`

Serializes a value as JSON using JavaScript semantics.

**Parameters:**

- `value` — Value to serialize.

**Returns:**

- `string` — JSON representation.

**Example:**

```lua
print(js.stringify({1, 2, 3})) -- [1,2,3]
```

## js.tojs

`js.tojs(value)`

Converts a Lua value to its JavaScript representation.

**Parameters:**

- `value` — Lua value to convert.

**Returns:**

- Value — Converted JavaScript value.

**Example:**

```lua
local jsArray = js.tojs({1, 2, 3})
```

## js.tolua

`js.tolua(value)`

Converts a JavaScript value to its Lua representation.

**Parameters:**

- `value` — JavaScript value to convert.

**Returns:**

- Value — Converted Lua value.

**Example:**

```lua
local luaTable = js.tolua(jsArray)
```
<!--/lua-->

