A quick-reference guide to SilverBullet-specific terminology:
${query[[
  from p = tags.glossary
  where p.tag == "page"
  order by p.name
  select template.new[==[
    - [[${name}]]: ${description}
]==](p)
]]}
