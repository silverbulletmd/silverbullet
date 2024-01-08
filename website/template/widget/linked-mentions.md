---
description: Adds Linked Mentions to all pages
tags: template
type: widget:bottom
where: 'true'
---
```template
# We need to escape handlebars directives here, since we're embedding
# this template into a template (INCEPTION)
template: |
  {{escape "#if ."}}
  # Linked Mentions
  {{escape "#each ."}}
  * [[{{escape "ref"}}]]: `{{escape "snippet"}}`
  {{escape "/each"}}
  {{escape "/if"}}
query: |
  link where toPage = "{{@page.name}}" and page != "{{@page.name}}"
```
