---
tags: template
description: Turn the current line into a task
hooks.snippetTemplate:
  name: "task"
  match: "^(\\s*)[\\-\\*]?\\s*(\\[[ xX]\\])?\\s*"
---
$1* [ ] 