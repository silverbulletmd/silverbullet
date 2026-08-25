#meta

We would like to keep our space clean. These are some tools that help you do that.

# Aspiring pages
This shows page links (max 20 to keep things sensible) that link to a page that does not (yet) exist. These could be broken links or just pages _aspiring_ to be created.

${some(query[[
  from a = index.aspiringPages()
  limit 20
  select template.new[==[
    * [[${ref}]]: broken link to [[${name}]]
]==](a)
]]) or "No aspiring pages, all good!"}

# Ambiguous links
These links are written as a bare page name that matches more than one page, so which page they open depends on where they are written. Following one asks which page you meant; to pin a link for good, write it out as a unique path or rename one of the colliding pages.

${some(query[[
  from a = index.ambiguousLinks()
  limit 20
  select template.new[==[
    * [[${ref}]]: ${name} currently opens ${resolvesTo}
]==](a)
]]) or "No ambiguous links, all good!"}
