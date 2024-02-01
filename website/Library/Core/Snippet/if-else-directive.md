---
description: Insert a template '#if' directive with 'else'
tags: template
hooks.snippet.slashCommand: "#if-else"
---
{{escapeDirective("#if |^|")}}

{{escapeDirective("else")}}

{{escapeDirective("/if")}}