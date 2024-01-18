---
displayName: "Daily Note"
description: "Open your daily note page"
tags: template
hooks.newPage:
  suggestedName: "📅 {{today}}"
  confirmName: false
  openIfExists: true
  forPrefix: "📅 "
  command: "Open Daily Note"
  key: "Alt-Shift-d"
---
* |^|