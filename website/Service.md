The SilverBullet service bus is an extension mechanism for defining and discovering pluggable behavior. It lets you register named services that can be discovered and invoked by other parts of SilverBullet or your own scripts. This enables a plugin-like architecture where multiple implementations can compete for the same operation, with the best match winning.

# Concepts
* **Service**: A named handler defined via `service.define`. It advertises itself under a _selector_ and provides a `run` callback.
* **Selector**: A string used to advertise and discover services. Can contain wildcards (e.g. `export:*`).
* **Discovery**: The process of finding all services matching a selector. Each service's `match` function determines if it applies and at what priority.
* **Invocation**: Running a discovered service's `run` callback.

See [[API/service]] for more information on how to use and define your own services.
