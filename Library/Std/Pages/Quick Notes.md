This is your ${widgets.commandButton("Quick Note")} inbox.

${template.each(query[[
  from index.tag "page"
  where _.name:startsWith("Inbox/")
  order by _.lastModified desc
]], templates.fullPageItem)}