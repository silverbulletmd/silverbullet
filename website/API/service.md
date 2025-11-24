#api/syscall

Exposes a simple service registry API leveraged by various parts of SilverBullet, see [[Service]].

## Example
```space-lua
service.define {
  selector = "greeter-service",
  -- no priority set
  match = {},
  run = function(name)
    return "Hello " .. name
  end
}

service.define {
  selector = "greeter-service",
  match = function(name)
    if name == "Pete" then
      -- takes precendence with an exact match
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

## API
### service.define(spec)
Defines a service matching a selector.

Spec arguments:
* `selector`: service selector, can contain wildcards (e.g. `hello:*`)
* `match(data)`: callback (`data` argument), returns a match table if this service is a match or `nil` otherwise. A match table is service specific, but at least contains a `priority` key to set the service priority (used for sorting by `service.discover` and `service.invokeBestMatch`). Instead of a function can also simply be a match object directly.
* `run(data)`: callback to be invoked when the service is invoked

### service.discover(selector, data)
Discovers previously defined service matching a given selector. 

Return value is a list of tables (can be empty) with keys:
* `id`: guid of the service (automatically generated)
* `priority`: priority of service match (list will already be pre-sorted based on this key if present)

### service.invoke(match, data)
Invokes a service match (as returned by [[#service.discover(selector, options)]]).

### service.invokeBest(selector, options)
Performs a `discover` based on the selector, then immediately performs and `invoke` on the best match (based on priority).