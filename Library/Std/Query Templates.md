#meta

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

-- Renders a task object as a togglable task
templates.taskItem = template.new([==[
* [${state}] [[${ref}]] ${name}
]==])

-- Renders an item object
templates.itemItem = template.new([==[
* ${name}
]==])

-- Renders a paragraph object
templates.paragraphItem = template.new([==[
* [[${ref}]]
]==])
```


# Examples
`template.pageItem`:
${template.each(query[[from index.tag "page" limit 3]], templates.pageItem)}

`template.taskItem`:
* [ ] Task 1
* [ ] Task 2

${template.each(query[[from index.tag "task" where page == _CTX.currentPage.name]], templates.taskItem)}

`template.itemItem`:
* Item 1
* Item 2

${template.each(query[[from index.tag "item" where page == _CTX.currentPage.name]], templates.itemItem)}
