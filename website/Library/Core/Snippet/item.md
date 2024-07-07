---
tags: template
description: Make this a bullet item
hooks.snippet:
  slashCommand: item
  matchRegex: "^(\\s*)[\\-\\*]?\\s*"
  command: "Text: Turn into a bullet item"
  key: "Ctrl-q i"
---
$1* 