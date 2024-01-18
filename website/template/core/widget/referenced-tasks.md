---
tags: template
description: |
  Shows all tasks that reference (tag) the current page. For instance a task that references `[[John]]` in its name, would appear on the `John` page if it would use this [[sets/tasks/incoming]] template.
---

```query
task where name =~ /\[\[{{escapeRegexp @page.name}}\]\]/ where done = false render [[template/core/query/task]]
```