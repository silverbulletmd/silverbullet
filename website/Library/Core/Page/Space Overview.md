#meta

This page compiles some useful things about your space and may also be useful for debugging things.

# Stats
```template
**Total pages:** {{count({page select name})}}
**Total attachments:** {{count({attachment select name})}}
**Total tags:** {{count({tag select name})}}
```

# Active [[!silverbullet.md/Space Script]]
```template
{{#each {space-script}}}
* [[{{ref}}]]
{{/each}}
```

# Active [[!silverbullet.md/Space Style]]
```template
{{#each {space-style}}}
* [[{{ref}}]]
{{/each}}
```

# Active [[!silverbullet.md/Space Config]]
Composed from all the pieces of `space-config` across your space.

```template
~~~yaml
{{yaml(@config)}}
~~~
```
