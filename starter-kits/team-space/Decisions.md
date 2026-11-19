The decision log: one page per decision, with the context and consequences. A decision is `proposed` until it is `accepted`, and `superseded` once a later decision replaces it.

${widgets.commandButton("New decision", "Decision: New")}

${some(query[[
  from p = index.pages("decision")
  order by p.date desc
  select {Decision = markdown.link(p), Date = p.date, Status = p.status}
]]) or "_No decisions recorded yet._"}
