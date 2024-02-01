---
tags: template
description: |
  Shows all tasks that contain a link the current page. For instance a task that references `[[John]]` in its name, would appear on the `John` page.
---

```query
task where name =~ /\[\[{{escapeRegexp(@page.name)}}\]\]/ where done = false render [[Library/Core/Query/Task]]
```