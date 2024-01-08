Live templates render [[Templates]] inline in a page. They’re called “Live” because their content updates dynamically.

## Syntax
Live Templates are specified using [[Markdown]]‘s fenced code block notation using `template` as a language. The body of the code block specifies the template to use, as well as any arguments to pass to it.

Generally you’d use it in one of two ways, either using a `page` [[Templates|template]] reference, or an inline `template`:

Here’s an example using `page`:
```template
page: "[[template/today]]"
```

And here’s an example using `template`:
```template
template: |
   Today is {{today}}!
```

To pass a literal value to the template, you can specify the optional `value` attribute:
```template
template: |
   Hello, {{name}}! Today is _{{today}}_
value:
   name: Pete
```

You can also pass in the result of a [[Live Queries|query]] as a value by setting the `query` attribute:

```template
template: |
   {{#each .}}
   * #{{name}}
   {{/each}}
query: |
   tag where parent = "page" select name
```

If you just want to render the raw markdown without handling it as a handlebars template, set `raw` to true:
```template
template: |
   This is not going to be {{processed}} by Handlebars
raw: true
```

