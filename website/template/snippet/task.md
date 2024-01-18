---
tags: template
description: Turn the current line into a task
hooks.snippet:
  slashCommand: task
  matchRegex: "^(\\s*)[\\-\\*]?\\s*(\\[[ xX]\\])?\\s*"
  command: "Turn into task"
  key: "Ctrl-q t"
---
$1* [ ] 