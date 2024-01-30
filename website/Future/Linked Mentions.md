---
description: Adds Linked Mentions to pages
tags: template
hooks.bottom.where: 'false'
---
This is the future implementation of [[Linked Mentions]], but we need to release 0.7.0 first that’s why this is disabled for now.

```block
{{#let @linkedMentions = query("link where toPage = ? and page != ? order by page", @page.name, @page.name)}}
{{#if @linkedMentions}}
# Linked Mentions
{{#each @linkedMentions}}
* [[{{ref}}]]: `{{snippet}}`
{{/each}}
{{/if}}
{{/let}}
```