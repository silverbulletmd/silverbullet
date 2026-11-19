Welcome to your personal space. This page serves purely as a starting point. Feel free to replace it completely or adjust it to your needs. This space is yours.

# Recent quick notes
${widgets.commandButton("Create quick note", "Quick Note")}

${query[[
  from p = index.subPages("Inbox")
  order by p.lastModified desc
  limit 10 select templates.fullPageItem(p)
]]}

# Recent journal entries
${widgets.commandButton("Today's entry", "Journal: Today")}

${query[[
  from j = index.contentPages("journal")
  order by j.date desc
  limit 14
  select templates.pageItem(j)
]]}

# Recent incomplete tasks
${query[[
  from t = index.tasks()
  where not t.done
  order by t.pageLastModified
  desc limit 10
  select templates.taskItem(t)
]]}

# Recently modified pages
${query[[
  from p = index.contentPages()
  order by p.lastModified
  select {
    Name = markdown.link(p.name),
    Modified = p.lastModified
  }
]]}