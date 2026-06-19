It’s important to keep documentation current, here are a few views that help identify parts that may require maintance.

# Revision review queue
These pages haven’t been reviewed in over three months:

${some(query[[
  from p = index.contentPages()
  where p.lastReviewed and p.lastReviewed < os.date("%Y-%m-%d", os.time() - 90*24*60*60)
  order by p.lastReviewed
  select template.new[==[
    * [[${p.name}]] Last reviewed: _${p.lastReviewed}_
  ]==]({p=p})
]]) or "_None right now, nice job!_ 🥳"}
