Follow a guide for a task you want to complete. Each guide explains the starting point it needs. [[Getting Started]] covers Markdown, links, attributes and your first query.

${query[[
  from entry = docsNav.pages
  where entry.name:startsWith("Guides/")
  select templates.pageItem(entry)
]]}

For installation, synchronization and recovery, use [[Administration|Setup and administration]]. For definitions and complete feature behavior, use [[Reference]].
