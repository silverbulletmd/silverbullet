---
displayName: "Daily Note"
description: "Open your daily note page"
tags: template
hooks.pageTemplate:
  suggestedName: "📅 {{today}}"
  confirm: false
  openIfExists: true
  command:
    name: "Open Daily Note"
    key: "Alt-Shift-d"
---
* |^|