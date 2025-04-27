Template functions that use the [[API/template#template.new(template)]] function.

## template.new(template)
Returns a template function that can be used to render a template. Conventionally, a template string is put between `[==[` and `]==]` as string delimiters.

Example:

```space-lua
examples = examples or {}

examples.sayHello = template.new[==[Hello ${name}!]==]
```

And its use: ${examples.sayHello {name="Pete"}}

## template.each(collection, template, empty="")
Iterates over a collection and renders a template for each item. Optionally specify output for an empty collection.

Example:

${template.each(query[[from index.tag "page" limit 3]], template.new[==[
    * ${name}
]==])}
