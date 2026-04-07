Hello 👋!

Welcome to the wondrous world of SilverBullet. A world that once you discover and appreciate, you’ll never want to leave.

_One of us!_

If you’re confused and don’t know what to do, have a look at the [Manual](https://silverbullet.md/Manual) or the [Quick Start](https://silverbullet.md/Quick%20Start) page.

# Recent quick notes
*Create:* ${widgets.commandButton "Quick Note"}

${some(query[[
  from p = tags.page
  where p.name:startsWith("Inbox/")
  order by p.lastModified desc
  limit 10 select templates.fullPageItem(p)
]]) or "_No quick notes yet!_"}

# Recent incomplete tasks
${some(query[[
  from t = tags.task
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
  select templates.pageItem(p) 
]]}
