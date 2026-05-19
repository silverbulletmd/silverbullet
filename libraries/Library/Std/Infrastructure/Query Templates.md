---
description: Implements generally useful query templates.
tags: meta
---
A work-in-progress library of generally useful templates for rendering queries.

```space-lua
-- Renders a page object as a linked list item
templates.pageItem = template.new([==[
* [[${name}]]
]==])

-- Renders a page object as a linked list item with full path
templates.fullPageItem = template.new([==[
* [[${name}|${name}]]
]==])

-- Renders a task object as a togglable task. Anchor refs are bare names
-- (no @ or #) — prefix them with $ so the resulting wikilink resolves
-- through the anchor index. Position/header refs already contain @ or #
-- and pass through unchanged.
templates.taskItem = template.new([==[
* [${state}] [[${string.find(ref, "[@#]") and ref or "$" .. ref}]] ${name}
]==])

-- Renders an item object
templates.itemItem = template.new([==[
* [[${string.find(ref, "[@#]") and ref or "$" .. ref}]] ${name}
]==])

-- Renders a paragraph object
templates.paragraphItem = template.new([==[
* [[${string.find(ref, "[@#]") and ref or "$" .. ref}]] ${text}
]==])

-- Renders a tag object
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
