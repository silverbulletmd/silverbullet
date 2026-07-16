---
tags: api/syscall
references:
- client/service_registry.ts
- client/plugos/syscalls/service_registry.ts
---

The Service API exposes a simple service registry leveraged by various parts of SilverBullet. See [[Service]].

${spacelua.renderApiDocumentation("service")}

# Architecture

Services are built on top of [[Event|Events]]. When a service is defined, it registers two event listeners:

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
