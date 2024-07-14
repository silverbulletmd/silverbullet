---
pageDecoration.prefix: "🎄 "
---
Page decorations allow you to “decorate” pages in various ways.

For now “various ways” means just one way (adding a visual prefix), but in the future, more such decorations will likely be added.

There are two ways to decorate a page.

# Frontmatter
The first is demonstrated in the [[Frontmatter]] of this page, by using the special `pageDecoration` attribute.

# Settings
The more useful way is to apply decorations to pages _dynamically_, you can use the `pageDecorations` attribute in [[SETTINGS]].

Every page decoration has two parts:
* `where`: the [[Expression Language]] expression that has to evaluate to `true` for a given page for that decoration to be applied.
* A set of decorations to apply, see [[#Supported decorations]]

For example:
```yaml
- where: 'tags = "person"'
  prefix: "🧑 "
```

This will prefix all pages tagged with `#person` with a 🧑 emoji.

Here on silverbullet.md, we have a decoration like this for pages tagged with #plug: [[Plugs/Emoji]] and [[Plugs/Git]] for instance.

# Supported decorations
For now there’s just one:

* `prefix`: A (visual) string prefix (often an emoji) to add to all page names. This prefix will appear in the top bar as well as in (live preview) links to this page. For example, the name of this page is actually “Page Decorations”, but when you link to it, you’ll see it’s prefixed with a 🎄: [[Page Decorations]]

Again — later, more such decorations may be added.