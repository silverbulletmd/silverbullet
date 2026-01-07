#meta/api #maturity/beta

Implements APIs for defining custom task states. Currently extremely basic.

# API

## taskState.define(def)
Defines a custom task state. Options:
* `name`: name of the state
* `done`: whether or not the state should be considered "done" or not, used by the `Task: Remove Completed` command

# Example
```lua
taskState.define {
  name = "TO DO"
}
taskState.define {
  name = "IN PROGRESS"
}
taskState.define {
  name = "DONE",
  done = true
}
```

# Implementation

```space-lua
-- priority: 50
taskState = taskState or {}

function taskState.define(spec)
  config.set({"taskStates", spec.name}, spec)
end
```
