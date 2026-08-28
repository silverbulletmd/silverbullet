---
description: Visual customization (icons, prefixes, CSS) applied to pages matching certain criteria.
tags: maturity/beta glossary
pageDecoration:
  prefix: "🎄 "
  cssClasses:
  - christmas-decoration
references:
- plugs/index/page.ts
---
Page decorations allow you to “decorate” pages in various fun ways.

# Supported decorations
* `prefix`: A (visual) string prefix (often an emoji) to add to all page names. This prefix will appear in the top bar as well as in (live preview) links to this page. For example, the name of this page is actually “Page Decorations”, but when you link to it, you’ll see it’s prefixed with a 🎄: [[Concept/Page Decoration]]
* `cssClasses`: (list of strings) Attaches one or more CSS classes the page's `<body>` tag, wiki links, auto complete items and [[Feature/Page Picker]] entries for more advanced styling through a [[Concept/Space Style]] (see [[#Use case: pimp my page]] for an example).

# Apply with [[Concept/Frontmatter]]
This is demonstrated in the [[Concept/Frontmatter]] at the top of this page, by using the special `pageDecoration` attribute. This is how we get the fancy tree (🎄) in front of the page name. Sweet.

## Use case: pimp my page
Let’s say you feel you want to pimp up a specific page with some Christmas-level decoration, and prefixing it with a tree just doesn’t do it for you. The `cssClasses` decoration is saying: hold my beer. 

Note that in this page’s [[Concept/Frontmatter]] the `christmas-decoration` class is attached via `pageDecoration.cssClasses`. Now let’s hook into that with some [[Concept/Space Style]]:

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
