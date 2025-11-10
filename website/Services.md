The SilverBullet service bus is an extension mechanism built into SilverBullet.

# Concepts
* Discovery: the process of discovering available services based on a _selector_.
* Selector: a string (possibly with a wildcard `*`) used to advertise as well as discover services.
* Service: defined via [[API/service#service.define(spec)]]), implements a service advertised via a selector.
* Invocation: running a discovered service.

# Architecture
Services are an abstraction built on top of [[Events]]. When a new service is defined, it registers itself listening to the `discover:<<selector>>` event (to be discovered), and under `service:<<guid>>` to be invoked.

Service discovery happens by broadcasting an event on the event bus with the given selector, returning a list of services that are a match, ordered by (self assigned) priority. One (or all) of these services can then be invoked based on their returned ID.

See [[API/service]] for API details.