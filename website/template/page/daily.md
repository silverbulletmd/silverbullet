---
displayName: "Daily Note"
description: "Open your daily note page"
tags: template
hooks.pageTemplate:
  suggestedName: "📅 {{today}}"
  confirm: false
  openIfExists: true
  command:
    name: "Open Daily Note 2"
    key: "Alt-Shift-d"
---
* |^|