---
description: Adds Linked Mentions to pages
tags: template
hooks.bottom.where: 'true'
---
{{#let @linkedMentions = query("link where toPage = ? and page != ? order by page", @page.name, @page.name)}}
{{#if @linkedMentions}}
# Linked Mentions
{{#each @linkedMentions}}
* [[{{ref}}]]: `{{snippet}}`
{{/each}}
{{/if}}
{{/let}}
