---
description: Visual customization (icons, prefixes, CSS) applied to pages matching certain criteria.
tags: maturity/beta glossary
pageDecoration:
  icon: gift
  tree:
    priority: -1
  cssClasses:
  - christmas-decoration
references:
- plugs/index/page.ts
---
Page decorations allow you to “decorate” pages in various fun ways.

# Supported decorations
* `cssClasses`: (list of strings) Attaches one or more CSS classes the page's `<body>` tag, wiki links, auto complete items and [[Page Picker]] entries for more advanced styling through a [[Space Style]] (see [[#Use case: pimp my page]] for an example).
* `icon`: The icon drawn with the page in the top bar, [[Navigator]], auto complete, and page links. Use a [Feather](https://feathericons.com/) icon name (`star`), the same name namespaced (`feather:star`), or sanitized literal SVG markup.
* `tree.priority`: (number, default `0`) Floats the page above its lower-priority siblings in the space tree. See [[#Ordering the space tree]].
* `tree.hide`: (boolean) Keeps the page out of the space tree only, leaving it in the page picker and in completions.
* `prefix`: A textual string prefix to add to page names. It appears in the top bar, page picker, auto complete, and links to the page. Use `icon` instead when the prefix is only meant to be a visual symbol.
* `hide`: (boolean) Keeps the page out of the [[Navigator]] — the page picker, the space tree — and out of page completions. The picker's “All” segment still lists it.

# Apply with [[Frontmatter]]
This is demonstrated in the [[Frontmatter]] at the top of this page, using the special `pageDecoration` attribute. The `gift` icon appears beside this page in the surfaces listed above.

## Use case: pimp my page
Let’s say you feel you want to pimp up a specific page with some Christmas-level decoration, and giving it an icon just doesn’t do it for you. The `cssClasses` decoration is saying: hold my beer.

Note that in this page’s [[Frontmatter]] the `christmas-decoration` class is attached via `pageDecoration.cssClasses`. Now let’s hook into that with some [[Space Style]]:

```space-style

/* Style page links */
a.christmas-decoration {
  background-color: #b4e46e;
}

/* Style main editor components */
body.christmas-decoration #sb-top {
  background-color: #b4e46e;
}

/* Style auto complete items */
.cm-tooltip-autocomplete li.christmas-decoration {
  background-color: #b4e46e;
}

/* Style page picker item */
.sb-result-list .sb-option.christmas-decoration {
  background-color: #b4e46e;
}
```

And _boom_! Ain’t that pretty?
