All team members on a single page.

${query[[
  from p = index.contentPages("person")
  where p.perm == "rw"
  select {
    name = markdown.link(p.name),
    role = p.role
  }
]]}