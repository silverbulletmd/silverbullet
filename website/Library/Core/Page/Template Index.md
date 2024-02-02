This page lists all templates currently available in your space.

# New Page
These [[!silverbullet.md/Page Templates]] are available through the {[Page: From Template]} command:

```query
template where hooks.newPage render [[Library/Core/Query/Template]]
```

# Snippets
These can be used as [[!silverbullet.md/Snippets]] via [[!silverbullet.md/Slash Commands]]:

```template
{{#each {
   template
   where hooks.snippet
   order by hooks.snippet.slashCommand
}}}
* [[{{ref}}|/{{hooks.snippet.slashCommand}}]] {{description}}
{{/each}}
```

# Widgets
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
Use with [[!silverbullet.md/Live Templates#Include]] to render useful things in your pages:

```query
template
where name =~ /\/Widget\// and not hooks.top and not hooks.bottom
order by order
render [[Library/Core/Query/Template]]
```
