This is an attempt at collecting useful, reusable templates so you don’t have to reinvent the wheel.

The most convenient ways to use them is using [[Federation]]. This will synchronize these templates into your space and make them available for use instantly.

To set this up, add this to your [[SETTINGS]]:

```yaml
federate:
- uri: silverbullet.md/template
```

If you don’t want to sync _all_ these templates, you can use more specific URIs, e.g.
```yaml
federate:
- uri: silverbullet.md/template/tasks
```
to just get the `tasks` stuff.

To reference a template, use the federation syntax, e.g. `[[!silverbullet.md/template/tasks/task]]`.

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
template where name =~ /^template\/tasks/
order by order
render [[template/documented-template]]
```
## Debugging
```query
template where name =~ /^template\/debug/ render [[template/documented-template]]
```
