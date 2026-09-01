---
description: Visual customization (icons, prefixes, CSS) applied to pages matching certain criteria.
tags: maturity/beta glossary
pageDecoration:
  prefix: "🎄 "
  icon: zap
  tree:
    priority: -1
  cssClasses:
  - christmas-decoration
references:
- plugs/index/page.ts
---
Page decorations allow you to “decorate” pages in various fun ways.

# Supported decorations
* `prefix`: A (visual) string prefix (often an emoji) to add to all page names. This prefix will appear in the top bar as well as in (live preview) links to this page. For example, the name of this page is actually “Page Decorations”, but when you link to it, you’ll see it’s prefixed with a 🎄: [[Concept/Page Decoration]]
* `cssClasses`: (list of strings) Attaches one or more CSS classes the page's `<body>` tag, wiki links, auto complete items and [[Feature/Page Picker]] entries for more advanced styling through a [[Concept/Space Style]] (see [[#Use case: pimp my page]] for an example).
* `icon`: The icon the page draws with wherever the [[Feature/Navigator]] shows one — the space tree and the page picker. A [Feather](https://feathericons.com/) icon name (`star`), the same namespaced (`feather:star`), or literal SVG markup.
* `hide`: (boolean) Keeps the page out of the [[Feature/Navigator]] — the page picker, the space tree — and out of page completions. The picker's “All” segment still lists it.
* `tree.priority`: (number, default `0`) Floats the page above its lower-priority siblings in the space tree. See [[#Ordering the space tree]].
* `tree.hide`: (boolean) Keeps the page out of the space tree only, leaving it in the page picker and in completions.

# Ordering the space tree
The space tree is alphabetical. `tree.priority` bumps a page out of that order without touching anything else: it sorts a page against its *siblings* only, higher first, with everything left at the default `0` keeping its alphabetical order among itself. A negative number sinks a page below the undecorated ones.

```yaml
pageDecoration:
  tree:
    priority: 10
```

Because a priority only ever reorders one level, a priority on `Journal/Today` moves it within `Journal` and leaves the `Journal` folder where it was. To pin a folder, put the decoration on the folder's own page — `Projects.md` for the `Projects` folder, which the tree already shows as one row.

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
