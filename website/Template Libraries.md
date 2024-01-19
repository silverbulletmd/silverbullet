> **warning** Experimental
> This is still an experimental idea. These templates may change, be renamed etc. prepare yourself for breakage.

A lot of useful functionality in SilverBullet is implemented through various types of [[Templates]].


{[Federation: Copy Prefix|Import All]("!localhost:3001/template/core/")}

# Page Templates
Use these [[Page Templates]] with the {[Page: From Template]} command.

```query
template where hooks.newPage render [[Library/Core/Query/Template]]
```

# Slash Templates
These can be used as [[Snippets]]:

```query
template where hooks.snippet render [[Library/Core/Query/Template]]
```

# Blocks
## Top Blocks
```query
template
where hooks.topBlock
order by order
render [[Library/Core/Query/Template]]
```

## Bottom Blocks
```query
template
where hooks.bottomBlock
order by order
render [[Library/Core/Query/Template]]
```


## Inline
Use these as `page` in [[Live Templates]] to render useful things in your pages:

```query
template
where name =~ /^template\/block/ and hooks.topBlock = null and hooks.bottomBlock = null
order by order
render [[Library/Core/Query/Template]]
```

# Live Query
Use these in your `render` clauses in [[Live Queries]].

```query
template
where name =~ /^template\/query/
order by order
render [[Library/Core/Query/Template]]
```
