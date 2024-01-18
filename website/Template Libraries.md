> **warning** Experimental
> This is still an experimental idea. These templates may change, be renamed etc. prepare yourself for breakage.

A lot of useful functionality in SilverBullet is implemented through various types of [[Templates]].


{[Federation: Copy Prefix|Import All]("!localhost:3001/template/core/")}

# Page Templates
Use these [[Page Templates]] with the {[Page: From Template]} command.

```query
template where hooks.newPage render [[internal-template/documented-template]]
```

# Slash Templates
These can be used as [[Slash Templates]]:

```query
template where hooks.snippet render [[internal-template/documented-template]]
```

# Blocks
## Top Blocks
```query
template
where hooks.topBlock
order by order
render [[internal-template/documented-template]]
```

## Bottom Blocks
```query
template
where hooks.bottomBlock
order by order
render [[internal-template/documented-template]]
```


## Inline
Use these as `page` in [[Blocks]] to render useful things in your pages:

```query
template
where name =~ /^template\/block/ and hooks.topBlock = null and hooks.bottomBlock = null
order by order
render [[internal-template/documented-template]]
```

# Live Query
Use these in your `render` clauses in [[Live Queries]].

```query
template
where name =~ /^template\/query/
order by order
render [[internal-template/documented-template]]
```
