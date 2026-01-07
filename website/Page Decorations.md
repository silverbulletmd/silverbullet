---
tags: maturity/beta
pageDecoration:
  prefix: "🎄 "
  disableTOC: true
  cssClasses:
  - christmas-decoration
---
Page decorations allow you to “decorate” pages in various fun ways.
 
# Supported decorations
* `prefix`: A (visual) string prefix (often an emoji) to add to all page names. This prefix will appear in the top bar as well as in (live preview) links to this page. For example, the name of this page is actually “Page Decorations”, but when you link to it, you’ll see it’s prefixed with a 🎄: [[Page Decorations]]
* `cssClasses`: (list of strings) Attaches one or more CSS classes the page's `<body>` tag, wiki links, auto complete items and [[Page Picker]] entries for more advanced styling through a [[Space Style]] (see [[#Use case: pimp my page]] for an example).
* `disableTOC` (not technically built-in, but a feature of the [[^Library/Std/Widgets/Widgets|Table of Content]] widget): disable the TOC for this particular page.

# Apply with [[Frontmatter]]
This is demonstrated in the [[Frontmatter]] at the top of this page, by using the special `pageDecoration` attribute. This is how we get the fancy tree (🎄) in front of the page name. Sweet.

## Use case: pimp my page
Let’s say you feel you want to pimp up a specific page with some Christmas-level decoration, and prefixing it with a tree just doesn’t do it for you. The `cssClasses` decoration is saying: hold my beer. 

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
