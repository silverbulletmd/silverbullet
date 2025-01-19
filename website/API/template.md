Template functions that use the [[API/template#template.new(template)]] function.

## template.new(template)
Returns a template function that can be used to render a template. Conventionally, a template string is put between `[==[` and `]==]` as string delimiters.

Example:

```space-lua
examples = examples or {}

examples.say_hello = template.new[==[Hello ${name}!]==]
```

And its use: ${examples.say_hello {name="Pete"}}

## template.each(collection, template)
Iterates over a collection and renders a template for each item.

Example:

${template.each(query[[from index.tag "page" limit 3]], template.new[==[
    * ${name}
]==])}