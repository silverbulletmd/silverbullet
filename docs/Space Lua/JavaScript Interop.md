Space Lua runs in the browser and has direct access to JavaScript APIs through the `js` module. This enables you to use the browser's native capabilities and import external JavaScript libraries. Use this functionality with caution. With great power comes comes great responsibility.

The full API reference is at [[API/js]].

# Accessing browser APIs
Use `js.window` to access the browser's `window` object:

```lua
-- Get the current URL
local url = js.window.location.href

-- Set a timeout
js.window.setTimeout(function()
  editor.flashNotification("Timer fired!")
end, 3000)
```

# Importing JavaScript modules
Use `js.import` to load JavaScript modules from URLs (typically via CDNs like esm.sh):

```lua
local lodash = js.import("https://esm.sh/lodash@4.17.21")
local chunks = lodash.chunk({1, 2, 3, 4, 5, 6}, 2)
print(js.stringify(chunks))  -- [[1,2],[3,4],[5,6]]
```

# Converting between Lua and JavaScript values
Lua tables and JavaScript objects/arrays are different types. Space Lua tries its best to map between them the best in can, but sometimes you may need finer grained control:

* `js.tojs(luaValue)` — converts a Lua value to its JavaScript equivalent
* `js.tolua(jsValue)` — converts a JavaScript value to its Lua equivalent

# Creating JavaScript objects
Use `js.new` to instantiate JavaScript classes:

```lua
local obj = js.new(SomeConstructor, arg1, arg2)
```

# Async transparency
Space Lua handles JavaScript promises transparently. When a JavaScript function returns a Promise, Space Lua automatically awaits it — you don't need to write any special async/await code:

```lua
-- This just works, even though fetch() returns a Promise
local response = js.window.fetch("https://api.example.com/data")
```

# Iterating JavaScript async iterables
Use `js.eachIterable` to iterate over JavaScript async iterables:

```lua
for value in js.eachIterable(someAsyncIterable) do
  print(value)
end
```

# Logging
Use `js.log` to write to the browser's developer console:

```lua
js.log("Debug:", {name = "test", count = 42})
```

See also: [[API/js]], [[Space Lua]]
