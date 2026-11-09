---
tags: guide
---
The page you’re looking at is a “full” SilverBullet instance operating in read-only mode. Since it can be a bit confusing to read a tool’s documentation in the tool itself, a few pointers on how to navigate this space.

# Reveal the source
SilverBullet uses [[Live Preview]] to show formatted Markdown. Hold **Alt** (**Option** on macOS) and click rendered content to reveal its underlying source. In read-only docs you can inspect, select and copy that source. Clicking a different part of the page lets the revealed content render again.

For instance, here’s a query, **Alt-click** it to reveal its underlying source:

${query[[
  from p = index.contentPages()
  order by p.lastModified desc
  limit 5
  select {
    name = markdown.link(p.name),
    lastModified = p.lastModified
  }
]]}
