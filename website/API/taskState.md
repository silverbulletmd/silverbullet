#maturity/beta

APIs to define [[Task#Custom states]].

# API
## taskState.define(def)
Defines a custom task state. Options:
* `name`: name of the state
* `done`: whether or not the state should be considered "done" or not, used by the `Task: Remove Completed` command

Primarily used to offer code completion for custom task states for now.

## Example
```space-lua
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
Use:
* [TO DO] Still to do
* [DONE] Task already completed
