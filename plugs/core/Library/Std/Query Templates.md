A work-in-progress library of generally useful templates for rendering queries.

```space-lua
-- Renders a page object as a linked list item
templates.page_item = template.new([==[
* [[${name}]]
]==])

-- Renders a task object as a togglable task
templates.task_item = template.new([==[
* [${state}] [[${ref}]] ${name}
]==])
```


# Examples
`template.page_item`:
${template.each(query[[from index.tag "page" limit 3]], templates.page_item)}

`template.task_item`:
* [ ] Task 1
* [ ] Task 2

${template.each(query[[from index.tag "task" where page == _CTX.currentPage.name]], templates.task_item)}
