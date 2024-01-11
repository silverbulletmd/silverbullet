You can add a table of contents to a page using the `toc` [[Markdown/Code Widgets|Code Widget]].

In its most basic form it looks like this (click the edit button to see the code):

```toc
```

You can use it in two ways:

1. _Manually_, by adding a `toc` widget to the pages where you’d like to render a ToC
2. _Automatically_, using a [[Live Template Widgets|Live Template Widget]]

To have a ToC added to all pages with a larger (e.g. 3) number of headings, it is recommended to use [[template/widget/toc|this template widget]]. You can do this by either copy and pasting it into your own space, or by using [[Federation]] and have it included in your space that way:

```yaml
federation:
- uri: silverbullet.md/template/widget/toc
```

## Configuration
In the body of the `toc` code widget you can configure a few options:

* `header`: by default a “Table of Contents” header is added to the ToC, set this to `false` to disable rendering this header
* `minHeaders`: only renders a ToC if the number of headers in the current page exceeds this number, otherwise renders an empty widget
* `maxHeaders`: only renders a ToC if the number of headers in the current page is below this number, otherwise renders an empty widget

Example:
```toc
header: false
minHeaders: 1
```
