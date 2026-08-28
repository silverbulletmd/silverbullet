---
tags: api/syscall
references:
- client/service_registry.ts
- client/plugos/syscalls/service_registry.ts
---

The Service API exposes a simple service registry leveraged by various parts of SilverBullet. See [[Concept/Service]].

<!--#lua spacelua.renderApiDocumentation("service") -->
## service.define

`service.define(spec)`

Defines a service that can be discovered by selector.

**Parameters:**

- `spec` (`table`) — Selector, match rule, and run callback.

**Example:**

```lua
service.define { selector = "greeter", match = {}, run = function(name) return "Hello " .. name end }
```

## service.discover

`service.discover(selector, data)`

Discovers matching services sorted by descending priority.

**Parameters:**

- `selector` (`string`) — Service selector.
- `data` — Value passed to match callbacks.

**Returns:**

- `table` — Matching service descriptors.

## service.invoke

`service.invoke(match, data)`

Invokes a previously discovered service match.

**Parameters:**

- `match` (`table`) — Service match returned by service.discover.
- `data` — Value passed to the service.

**Returns:**

- Value — Service result.

## service.invokeBestMatch

`service.invokeBestMatch(selector, data)`

Discovers and invokes the highest-priority matching service.

**Parameters:**

- `selector` (`string`) — Service selector.
- `data` — Value used for matching and invocation.

**Returns:**

- Value — Best matching service result.

**Example:**

```lua
local greeting = service.invokeBestMatch("greeter", "Pete")
```
<!--/lua-->

# Architecture

Services are built on top of [[Concept/Event|Events]]. When a service is defined, it registers two event listeners:

1. `discover:<<selector>>` for service discovery
2. `service:<<guid>>` for invocation

Discovery broadcasts on the event bus and collects all matches, sorted by priority. Invocation calls the specific service's `run` callback.

# Example

```space-lua
service.define {
  selector = "greeter-service",
  match = {},
  run = function(name)
    return "Hello " .. name
  end
}

service.define {
  selector = "greeter-service",
  match = function(name)
    if name == "Pete" then
      return {priority=10}
    else
      return nil
    end
  end,
  run = function(name)
    return "Hello Pete, so happy to see you!"
  end
}
```

To invoke: ${service.invokeBestMatch("greeter-service", "Pete")} and ${service.invokeBestMatch("greeter-service", "Hank")}

