---
tags: template
description: |
  Shows all tasks that contain a link the current page. For instance a task that references `[[John]]` in its name, would appear on the `John` page.
hooks.top:
  where: 'true'
  order: 1
---
{{#let @linkedTasks = {task where not done and contains(name, "[[" + @page.name + "]]")}}}
{{#if @linkedTasks}}
# Linked Tasks
{{#each @linkedTasks}}
{{template([[Library/Core/Query/Task]], .)}}
{{/each}}
{{/if}}
{{/let}}
