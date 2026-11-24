Your team’s meetings, decisions and action items in one space.

Want to understand how this is set up? Read [[^Library/Setup Explanation]].

# Open action items
${query[[
  from t = index.tasks()
  where not t.done
    and table.includes(t.itags, "meeting")
  order by t.due, t.page
  select templates.taskItem(t)
]]}

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
