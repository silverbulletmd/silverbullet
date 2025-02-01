---
description: (Template) Insert `#if` directive with 'else'
tags: template
hooks.snippet:
  slashCommand: "#if-else"
  order: 10
  onlyContexts:
  - FencedCode:template
---
{{escapeDirective("#if |^|")}}

{{escapeDirective("else")}}

{{escapeDirective("/if")}}