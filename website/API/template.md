#api/space-lua

Template functions that use the [[API/template#template.new(template)]] function.

## template.new(template, stripIndent)
Returns a template function that can be used to render a template. Conventionally, a template string is put between `[==[` and `]==]` as string delimiters.
If `stripIndent` is set to true or omitted, the function will try to remove indentation at the start of the line. This can be useful for multiline strings.

Example:

```space-lua
examples = examples or {}

examples.sayHello = template.new[==[Hello ${name}!]==]
```

And its use: ${examples.sayHello {name="Pete"}}

## template.each(collection, template)
Iterates over a collection and renders a template for each item.

Example:

${template.each(query[[from index.tag "page" limit 3]], template.new[==[
    * ${name}
]==])}
