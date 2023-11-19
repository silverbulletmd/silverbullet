> **warning** Experimental
> This is still an experimental idea. These templates may change, be renamed etc. prepare yourself for breakage.

This is an attempt at collecting useful, reusable templates so you don’t have to reinvent the wheel.

While you may just copy & paste these templates to your own space, the most convenient ways to use them is using [[Federation]]. This will synchronize these templates into your space and make them available for use instantly.

To set this up, add the following this to your [[SETTINGS]]:

```yaml
federate:
- uri: silverbullet.md/template
```

If you don’t want to sync _all_ these templates, you can use more specific URIs, e.g.
```yaml
federate:
- uri: silverbullet.md/template/task
```
to just get the `task` stuff.

To reference a template, use the federation syntax, e.g. `[[!silverbullet.md/template/task]]`.

## Maintenance
```query
template where name =~ /^template\/maintenance/
order by order
render [[template/documented-template]]
```
## Pages
```query
template
where name =~ /^template\/pages/
order by order
render [[template/documented-template]]
```
## Tasks
```query
template where name =~ /^template\/task/
order by order
render [[template/documented-template]]
```
## Debugging
```query
template where name =~ /^template\/debug/ render [[template/documented-template]]
```
