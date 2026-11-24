Here’s how things are set up:

# Space Tree
[[^Library/Space Tree Outline]] defines the tree organization. You can change it on that page, or simply drag and drop items and use the context menu to make changes.

# Page templates
To quickly create various types of pages, there are page templates defined (you can also find these in the “Library” tab of the Space Tree, under `Library/Page Tempaltes`):
${query[[
  from p = index.libraryPages("meta/template/page")
  where p.perm == "rw"
  select {
    name = markdown.link(p.name)
  }
]]}

# Tags and schemas
Three custom tags have been defined:
* #decision to capture decisions (as pages)
* #person to represent people (as pages)
* #meeting to represent meetings (as pages)

Each have a schema defined, which you can find via ${widgets.commandButton "Workbench: Data"}, then selecting the tag on the left, and selecting the “Schema” segment on the right. [[^Library/Config]] describes the schema in code.