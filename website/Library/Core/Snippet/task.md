---
tags: template
description: Make this a task
hooks.snippet:
  slashCommand: task
  matchRegex: "^(\\s*)[\\-\\*]?\\s*(\\[[ xX]\\])?\\s*"
  command: "Text: Turn into task"
  key: "Ctrl-q t"
  exceptContexts:
  - FencedCode
---
$1* [ ] 