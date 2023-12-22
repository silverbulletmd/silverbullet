---
tags: template
type: live
description: Lists all pages with ".conflicted" in the name, created as a result of a synchronization conflict.
---

### Conflicting pages
```query
page where name =~ /\.conflicted/ render [[template/pages/page]]
```
