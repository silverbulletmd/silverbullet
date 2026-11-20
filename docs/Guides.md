Follow a guide for a task you want to complete. Each guide explains the starting point it needs. [[Getting Started]] covers Markdown, links, attributes and your first query.

${query[[
  from p = index.pages()
  where p.name:startsWith("Guides/")
  order by p.name
  select templates.pageItem(p)
]]}

For installation, synchronization and recovery, use [[Administration|Setup and administration]]. For definitions and complete feature behavior, use [[Reference]].
