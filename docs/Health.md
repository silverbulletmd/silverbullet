Documentation rots silently. This page is a "test suite" for the docs in this space — every check below is a live [[Space Lua/Integrated Query|query]] over the [[Object Index]], so it is always up to date. Think of it as CI for your docs.

# Broken & aspiring links
Links pointing at pages that don't exist yet — either broken links to fix, or pages still _aspiring_ to be written (max 20):

${some(query[[
  from a = index.aspiringPages()
  limit 20
  select template.new[==[
    * [[${ref}]] → broken link to [[${name}]]
  ]==](a)
]]) or "_No broken or aspiring links — everything resolves._ ✅"}

# Revision review queue
Pages that declare a `lastReviewed` date but haven't been reviewed in over three months:

${some(query[[
  from p = index.contentPages()
  where p.lastReviewed and p.lastReviewed < os.date("%Y-%m-%d", os.time() - 90*24*60*60)
  order by p.lastReviewed
  select template.new[==[
    * [[${p.name}]] — last reviewed _${p.lastReviewed}_
  ]==]({p=p})
]]) or "_Nothing overdue for review, nice job!_ 🥳"}
