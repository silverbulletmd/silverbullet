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

# Conflicting copies
These are pages that have conflicting copies (as a result of sync). Have a look at them as well as their original (non-conflicting) versions and decide which one to keep.

${some(query[[
  from p = index.pages()
  where p.name:find("%.conflicted:")
  select template.new[==[
    * [[${name:gsub("%.conflicted:.+$", "")}]]: conflict copy [[${name}]]
]==](p)
]]) or "No conflicting pages!"}
