---
tags: template
description: Turn the current line into a task
hooks.slashTemplate:
  name: "task"
  match: "^(\\s*)[\\-\\*]?\\s*(\\[[ xX]\\])?\\s*"
---
$1* [ ] 