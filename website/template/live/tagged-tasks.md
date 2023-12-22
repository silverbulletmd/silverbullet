---
tags: template
type: live
description: Queries all tasks tagged with a specific tag.
usage: Pass in the tag to filter on as the `value` of this template
order: 2
---

```query
task where tags = "{{.}}" and done = false render [[template/tasks/task]] 
```
