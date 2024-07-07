---
tags: template
description: |
  Shows all tasks that contain a link the current page. For instance a task that references `[[John]]` in its name, would appear on the `John` page.
# Disabled by default for now
# hooks.top.where: 'true'
---
{{#let @linkedTasks = {task where not done and name =~ "\[\[" + escapeRegexp(@page.name) + "\]\]"} }}
{{#if @linkedTasks}}
# Linked Tasks
{{#each @linkedTasks}}
{{template([[Library/Core/Query/Task]], .)}}
{{/each}}
{{/if}}
{{/let}}
