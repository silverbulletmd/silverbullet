Important [[Architecture]] decisions for SilverBullet are captured as [Architecture Decision Records](https://adr.github.io/) (template: [[^Library/Page Templates/ADR]]). Quietly also a showcase for how to use SilverBullet for [docs-as-code](https://silverbullet.md/docs-as-code).

# Stats
${query[[
  from p = index.pages("adr")
  group by p.status
  order by key
  select template.new[==[* ${status}: ${count}
]==]({status = key, count = #group})
]]}

# Active decisions
${query[[
  from p = index.pages("adr")
  where p.status == "proposed" or p.status == "accepted"
  order by p.date desc, p.name
  select template.new[==[* [[${name}|${name:match("[^/]+$")}]] — ${status}, ${date}, Owner: ${owner}
]==](p)
]]}

# Superseded & deprecated
${query[[
  from p = index.pages("adr")
  where p.status == "superseded" or p.status == "deprecated"
  order by p.date desc, p.name
  select template.new[==[* [[${name}|${name:match("[^/]+$")}]] — ${status}, ${date}, Owner: ${owner}${supersededBy and (", Superseded by: " .. table.concat(supersededBy, ", ")) or ""}
]==](p)
]]}

# Connections
Dynamically generated from ADR defined relationships. Dotted edges mark supersession. Click a node to open the ADR.

${mermaid.diagram(mermaid.relationGraph {
  pages = query[[from index.pages("adr")]],
  direction = "TD",
})}

# Decision history
${mermaid.diagram(mermaid.timeline{
  pages = query[[from index.pages("adr")]],
  title = "ADR decision history"
})}

# By status
${mermaid.diagram(mermaid.distribution{
  pages = query[[from index.pages("adr")]],
  by = "status",
  title = "ADRs by status"
})}
