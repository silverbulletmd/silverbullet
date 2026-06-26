Hello 👋!

Welcome to the wondrous world of SilverBullet. A world that once you discover and appreciate, you’ll never want to leave.

_One of us!_

If you’re confused and don’t know what to do, have a look at the [Manual](https://silverbullet.md/Manual), or perhaps more specifically, the [Getting Started](https://silverbullet.md/Getting%20Started) page. Got questions? Head over to [the community forums](https://community.silverbullet.md/).

This page serves purely as a starting point to not start with a blank slate. Feel free to ditch it completely or adjust it to your needs. This space is fully yours. Own it.

# Recent quick notes
${widgets.commandButton("Create quick note", "Quick Note")}

${some(query[[
  from p = index.subPages("Inbox")
  order by p.lastModified desc
  limit 10 select templates.fullPageItem(p)
]]) or "_No quick notes yet!_"}

# Recent journal entries
${widgets.commandButton("Today's entry", "Journal: Today")}

${some(query[[
  from j = index.pages(config.get("journal.tag"))
  where j.tag == "page"
  order by j.date desc
  limit 14
  select templates.pageItem(j)
]]) or "_No journal entries yet!_"}

# Recent incomplete tasks
${some(query[[
  from t = index.tasks()
  where not t.done
  order by t.pageLastModified
  desc limit 10
  select templates.taskItem(t)
]]) or "_All tasks done!_"}

# Recently modified pages
${query[[
  from p = index.contentPages()
  order by p.lastModified desc
  limit 10
  select templates.fullPageItem(p) 
]]}
