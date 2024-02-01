Live Templates are a type of [[Blocks|block]] that render [[Templates]] written in [[Template Language]] inline in a page. 

There are two variants of Live Templates:

* `template`: where the template is specified inline in a code block.
* `include`: where an external page (template) is _included_ and rendered.

Template blocks are specified using [[Markdown]]‘s fenced code block notation using either `template` or `include` as its language.

# Template
To specify a template to render inline, you can use the `template` block. The body is written in [[Template Language]].

```template
Today is {{today}}
```

# Include
A `template` block is configured using [[YAML]] in its body. The following attributes are supported:

* `page`: the page to use as a template
* `value`: an (optional) value to pass to the template
* `raw`: a page reference to include in the page without processing it as a template.

Here’s an example using `page`:
```include
page: "[[internal-template/today]]"
```

If you want to include another _page_ (not necessarily a template). unprocessed (so without replacing template placeholders), you can use `raw`:
```include
raw: "[[internal/test page]]"
```
