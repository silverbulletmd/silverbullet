How pages connect in SilverBullet, and how to explore those connections: links and backlinks, tags, transclusions, the file tree and the Object Graph.

${query[[
  from e = docsNav.pages
  where e.name:match "^Linking & Exploring/[^/]+$"
  select templates.docsPage(e)
]]}
