---
description: Implements generally useful query templates.
---
A work-in-progress library of generally useful templates for rendering queries.

```space-lua
-- priority: 10
--- Renders a page as a linked list item.
--- @param p page
templates.pageItem = template.new([==[
* [[${name}]]
]==])

--- Renders a page as a linked list item, with its full path.
--- @param p page
templates.fullPageItem = template.new([==[
* [[${name}|${name}]]
]==])

--- A link to where an object is, from its `ref`. Anchor refs are bare names
--- (no @ or #), so they get a `$` to resolve through the anchor index;
--- position and header refs already contain @ or # and pass through.
--- @param ref string
--- @return string
function templates.refLink(ref)
  return markdown.link(string.find(ref, "[@#]") and ref or "$" .. ref)
end

--- Renders a task as a togglable task, linked to where it is.
--- @param t task
templates.taskItem = template.new([==[
* [${state}] ${templates.refLink(ref)}: ${name}
]==])

--- Renders an item, linked to where it is.
--- @param i item
templates.itemItem = template.new([==[
* ${templates.refLink(ref)}: ${name}
]==])

--- Renders a paragraph, linked to where it is.
--- @param p paragraph
templates.paragraphItem = template.new([==[
* ${templates.refLink(ref)}: ${text}
]==])

--- Renders a tag as a link to its page.
--- @param t tag
templates.tagItem = template.new([==[
* [[tag:${name}|#${name}]]
]==])
```

# Examples
`template.pageItem`:
${query[[from p = index.pages() limit 3 select templates.pageItem(p)]]}

`template.taskItem`:

    * [ ] Task 1
    * [ ] Task 2

${query[[from t = index.tasks() where t.page == _CTX.currentPage.name select templates.taskItem(t)]]}

`template.itemItem`:

    * Item 1
    * Item 2

${query[[from i = index.items() where i.page == _CTX.currentPage.name select templates.itemItem(i)]]}

`template.tagItem`:

    * #tag1
    * #tag2
    * #tag3

${query[[from t = index.objects("tag") where t.page == _CTX.currentPage.name select templates.tagItem(t)]]}
