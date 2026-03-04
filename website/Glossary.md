A quick-reference guide to SilverBullet-specific terminology:
${template.each(query[[
  from p = tags.glossary
  where p.tag == "page"
  order by p.name
]], template.new [==[
    - [[${name}]]: ${description}
]==])}
