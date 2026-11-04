---
description: Writing or editing page prose, frontmatter, links, tags, attributes, tasks and mentions in SilverBullet Markdown. Read before writing page content others will read. Not needed to read pages, to edit a space-lua block, or to add a query or widget call such as ${...} to a page (use Space Lua, Querying or Building Interfaces).
tags: meta/skill
---
SilverBullet stores pages as plain Markdown. Keep prose useful when read outside SilverBullet, and preserve the style the space already uses: read a few neighbouring pages (or the space's operating manual, if it has one) before writing.

# Pages and links
A file `Projects/Orchard.md` is the page `Projects/Orchard`. The `read`, `write` and `edit` tools take the page name; page APIs and wiki links omit the `.md` suffix. Wiki links are rooted at the space root, regardless of the directory of the page containing them.

* `[[Projects/Orchard]]` links to a page.
* `[[Projects/Orchard|the project]]` adds a label.
* `[[Projects/Orchard#Decisions]]` links to a heading.
* `[[Projects/Orchard@123]]` is a position reference. Positions are UTF-16 offsets and move when the page is edited.

Backlinks are computed: do not maintain duplicate backlink lists. Renaming a page with the editor's `Page: Rename` command (or by editing the page name in the top bar) updates all references to it. Creating a page under a new name with `write` and deleting the old one does not, so for a rename ask the user to use the rename command, or find inbound links with a `lua` query (see the Querying page) and update them deliberately.

Use ATX headings (`#`, `##`). The page name already is the title, so start with a summary and keep `#` for sections. Prefer `*` bullets and one source line per prose paragraph; do not hard-wrap. These are authoring defaults, not parser requirements, so match what the space does. Use frontmatter delimiters for YAML rather than decorative horizontal rules.

# Frontmatter, tags and attributes
Frontmatter must be the very first thing in the file. Its keys become page attributes. The file name determines the page `name`; never override it in YAML.

```markdown
---
tags: project active
status: planning
owner: Mira
related:
  - "[[Garden Notes]]"
---
Orchard tracks the planting proposal.

# Next steps
* [ ] Draft a planting map #work [priority: high]
* [x] Inventory tools #work
```

When creating a set of similar pages (people, incidents, books), give every page of that kind the same tag, such as `tags: incident`, not just similar attributes. The tag is what makes the class queryable with `index.pages("incident")`. Space-separated bare names are the usual frontmatter convention; YAML arrays also work. Quote wiki links in YAML values, and quote any value containing a colon followed by a space: unquoted, it is invalid YAML.

Where a hashtag sits decides which object receives it. A paragraph holding only hashtags gives those tags to the page. A hashtag in ordinary prose tags its paragraph, and one on a list item or task tags that object. Contained objects may also inherit tags from their page: query results distinguish explicit `tags` from inherited `itags`.

Inline `[key: value]` attributes attach structured values to the object that contains them:

```markdown
A measured observation. [confidence: 0.8]

* Use the northern beds #decision [status: accepted]
* [ ] Check drainage [due: "2026-10-01"]
```

Tasks expose `done` and `state` in the index. Keep custom task states and nesting as they are; do not assume every non-blank checkbox means completed.

# Mentions and authorship
`@name` addresses an identity. A trailing `-- @name` (also with an em or en dash) signs the block instead of addressing anyone. A signature must end its line, and it does not create another inbox item. A single hyphen or `(@name)` is not a signature.

```markdown
@helper Please check the planting dates. -- @mira
```

Frontmatter `recipients: ["helper"]` addresses the whole page, and `authors: ["mira"]` credits it. Page authorship does not sign every unsigned mention in the body. In an owner-only space `@self` addresses the owner. Signatures are self-declared prose, not proof of identity. See the Mentions page for working an inbox.

# Dynamic content and code
An expression in dollar-brace delimiters evaluates Space Lua when the page renders and shows its value. A `space-lua` fence defines executable, space-wide code that loads after indexing. A plain `lua` fence is for a displayed example that must not be installed as a script. Writing `space-lua` fences or live expressions into a page changes what the space runs, so only do it when asked, and read the Space Lua page first.

````markdown
```space-lua
orchard = orchard or {}
function orchard.label()
  return "Planting plan"
end
```
````

Queries inside Lua look like `query[[from p = index.pages() limit 5 select p.name]]`; in Markdown, wrap such a call in a dollar-brace expression and it renders as a live table (the Querying page shows the pattern). Keep essential facts in ordinary prose rather than only in computed output, so the page still reads well elsewhere. Do not evaluate untrusted page code just to read or summarize it.

To give every page with a tag its own look, see the Building Interfaces page.
