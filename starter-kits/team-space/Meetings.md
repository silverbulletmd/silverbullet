Every meeting gets its own page, named by date. The newest are at the top.

${widgets.commandButton("New meeting", "Meeting: New")}

${some(query[[
  from p = index.pages("meeting")
  order by p.date desc
  select {Meeting = markdown.link(p), Date = p.date, Attendees = p.attendees}
]]) or "_No meetings yet._"}
