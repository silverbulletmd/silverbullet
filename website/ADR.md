Important [[Architecture]] decisions for SilverBullet are captured as [Architecture Decision Records](https://adr.github.io/) (template: [[^Library/Page Templates/ADR]]). See [[Health]] for records due for review.

## At a glance
${query[[
  from p = index.pages("adr")
  group by p.status
  order by key
  select { Status = key, Count = #group }
]]}

## Active decisions
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

## Superseded & deprecated
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
