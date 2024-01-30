Live Templates are a type of [[Blocks|block]] that render [[Templates]] written in [[Template Language]] inline in a page. 

There are two variants of Live Templates:

* `block`: where the template is specified inline.
* `template`: where an external page (template) is used to render the template

Template blocks are specified using [[Markdown]]‘s fenced code block notation using either `template` or `block` as its language.

# Block
To specify a template to render inline, you can use the `block` block:

```block
Today is {{today}}
```

# Template
A `template` block is configured using [[YAML]] in the body. The following attributes are supported:

* `page`: the page to use as a template
* `value`: an (optional) value to pass to the template
* `raw`: a page reference to include in the page without processing it as a template.

Here’s an example using `page`:
```template
page: "[[internal-template/today]]"
```

If you want to include another _page_ (not necessarily a template) unprocessed (so without replacing template placeholders), you can use `raw`:
```template
raw: "[[internal/test page]]"
```
