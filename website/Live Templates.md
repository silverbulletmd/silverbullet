Live Templates are a type of [[Blocks|block]] that render [[Templates]] inline in a page. 

Template blocks are specified using [[Markdown]]‘s fenced code block notation using `template` as a language. The body of the block specifies the template to use, as well as any arguments to pass to it.

Generally you’d use it in one of two ways, either using a `page` [[Templates|template]] reference, or an inline `template`:

Here’s an example using `page`:
```template
page: "[[internal-template/today]]"
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
query: |
   tag where parent = "page" select name
template: |
   {{#each .}}
   * #{{name}}
   {{/each}}
```

If you want to include another _page_ (not necessarily a template) unprocessed (so without replacing template placeholders), you can use `raw`:
```template
raw: "[[internal/test page]]"
```
