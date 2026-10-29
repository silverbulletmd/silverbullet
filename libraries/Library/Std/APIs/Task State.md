#meta/api

Implements APIs for defining custom task states. Currently extremely basic.

# API

## taskState.define(def)
Defines a custom task state. Repeated calls with the same `name` merge (set a field to `config.unset` to remove it). Options:
* `name` _(required)_: name of the state
* `done`: whether or not the state should be considered "done", used by the `Task: Remove Completed` command and for filtering via `t.done` in queries
* `order`: numeric value controlling the cycle order when toggling between states (lower values come first)

# Example
```lua
taskState.define {
  name  = "PLANNED",
  order = 1,
}
taskState.define {
  name  = "IN PROGRESS",
  order = 2,
}
taskState.define {
  name  = "FINISHED",
  order = 3,
  done  = true,
}
```

# Implementation

```space-lua
-- priority: 50
taskState = taskState or {}

--- Defines a custom task state, or merges `spec` into an existing one with the same name.
--- @param spec table { name: string, done?: boolean, order?: number }; `order` sets the toggle cycle order, lower first
--- @see API/taskState
function taskState.define(spec)
  config.merge({"taskStates", spec.name}, spec)
end
```
