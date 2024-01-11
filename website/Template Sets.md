> **warning** Experimental
> This is still an experimental idea. These templates may change, be renamed etc. prepare yourself for breakage.

This is an attempt at collecting useful, reusable templates so you don’t have to reinvent the wheel.

While you may just copy & paste these templates to your own space, the most convenient ways to use them is using [[Federation]]. This will synchronize these templates into your space and make them available for use instantly.

To set this up, add the following to your [[SETTINGS]]:

```yaml
federate:
- uri: silverbullet.md/template
```

If you don’t want to sync _all_ these templates, you can use more specific URIs, e.g.
```yaml
federate:
- uri: silverbullet.md/template/page/
```
to just get the page templates, for instance.

To reference a template, use the [[Federation]] syntax, e.g. `[[!silverbullet.md/template/task]]`.

# Page Templates
Use these [[Page Templates]] with the {[Page: From Template]} command.

```query
template where type = "page" render [[template/documented-template]]
```

# Slash Templates
These can be used as [[Slash Templates]]:

```query
template where type = "slash" render [[template/documented-template]]
```

# Live Templates
Use these as `page` in [[Live Templates]].

```query
template
where type = "live"
order by order
render [[template/documented-template]]
```

# Live Query
Use these in your `render` clauses in [[Live Queries]].

```query
template
where type = "query"
order by order
render [[template/documented-template]]
```

# Live Widget Templates
Use these to add various useful [[Live Template Widgets]] to your pages.

```query
template
where type =~ /^widget:/ and name =~ /^template\//
order by order
render [[template/documented-template]]
```
