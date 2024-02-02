---
description: (Template) Insert an `#if` directive
tags: template
hooks.snippet:
  slashCommand: "#if"
  order: 10
---
{{escapeDirective("#if |^|")}}

{{escapeDirective("/if")}}