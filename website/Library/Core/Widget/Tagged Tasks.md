---
tags: template
description: Queries all tasks tagged with a specific tag.
usage: Pass in the tag to filter on as the `value` of this template
---

```query
task where tags = "{{.}}" and not done render [[Library/Core/Query/Task]] 
```