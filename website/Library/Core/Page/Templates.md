This page lists all templates active in your space.

# New Page
$newPage
These [[!silverbullet.md/Page Templates]] are available through the {[Page: From Template]} command.

```query
template where hooks.newPage render [[Library/Core/Query/Template]]
```

# Snippets
$snippets
These can be used as [[!silverbullet.md/Snippets]] via [[!silverbullet.md/Slash Commands]]:

```query
template where hooks.snippet render [[Library/Core/Query/Template]]
```

# Widgets
$widgets
Widgets can either be automatically attached to the top or bottom of pages (matching certain criteria) or used inline via [[!silverbullet.md/Live Templates]].

## Top
```query
template
where hooks.top
order by order
render [[Library/Core/Query/Template]]
```

## Bottom
```query
template
where hooks.bottom
order by order
render [[Library/Core/Query/Template]]
```

## Inline
Use these as `page` in [[!silverbullet.md/Live Templates]] to render useful things in your pages:

```query
template
where name =~ /\/Widget\// and hooks.top = null and hooks.bottom = null
order by order
render [[Library/Core/Query/Template]]
```
