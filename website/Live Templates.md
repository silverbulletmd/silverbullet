Live templates rendering [[Templates]] inline in a page.

## Syntax
Live Templates are specified using [[Markdown]]‘s fenced code block notation using `template` as a language. The body of the code block specifies the template to use, as well as any arguments to pass to it.

Generally you’d use it in one of two ways, either using a `page` template reference, or an inline `template`:

Here’s an example using `page`:

```template
page: "[[template/today]]"
```
And here’s an example using `template`:

```template
template: |
   Today is {{today}}!
```
To pass in a value to the template, you can specify the optional `value` attribute:

```template
template: |
   Hello, {{name}}! Today is _{{today}}_
value:
   name: Pete
```
If you just want to render the raw markdown without handling it as a handlebars template, set `raw` to true:

```template
template: |
   This is not going to be {{processed}} by Handlebars
raw: true
```

