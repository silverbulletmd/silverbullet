Your team's meetings, decisions and action items, in one place.

# Open action items
${query[[
  from t = index.tasks()
  where not t.done and table.includes(t.itags, "meeting")
  order by t.due, t.page
  select {
    ["Action item"] = t.name,
    Owner = t.owner,
    Due = t.due,
    Meeting = markdown.link(t)
  }
]]}

Action items are tasks on meeting pages with an `[owner: …]` and an optional `[due: …]`. Tick them off on their meeting page.

# Latest [[Meetings]]
${query[[
  from p = index.pages("meeting")
  order by p.date desc
  limit 5
  select templates.pageItem(p)
]]}

# Recent [[Decisions]]
${query[[
  from p = index.pages("decision")
  order by p.date desc
  limit 5
  select {Decision = markdown.link(p), Date = p.date, Status = p.status}
]]}
