Important [[Architecture]] decisions for SilverBullet are captured as [Architecture Decision Records](https://adr.github.io/) (template: [[^Library/Page Templates/ADR]]). See [[Health]] for records due for review.

# Stats
${query[[
  from p = index.pages("adr")
  group by p.status
  order by key
  select { Status = key, Count = #group }
]]}

# Active decisions
${query[[
  from p = index.pages("adr")
  where p.status ~= "superseded" and p.status ~= "deprecated"
  order by p.status, p.name
  select {
    ADR = "[[" .. p.name .. "]]",
    Owner = p.owner,
    Decided = p.date
  }
]]}

# Superseded & deprecated
${query[[
  from p = index.contentPages("adr")
  where p.status == "superseded" or p.status == "deprecated"
  order by p.name
  select {
    Status = p.status,
    ADR = "[[" .. p.name .. "]]",
    ["Superseded by"] = p.supersededBy,
    Owner = p.owner,
    Decided = p.date
  }
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
