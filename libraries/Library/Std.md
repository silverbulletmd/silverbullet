#meta

This is the standard library distributed as part of SilverBullet core. All pages under this prefix are read-only and cannot be modified directly.

${template.each(query[[
  from index.tag "page"
  where name:startsWith("Library/Std/")
]], templates.pageItem)}