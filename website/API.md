This describes the APIs available in [[Space Lua]]:

## Syscall APIs
${template.each(query[[ from p = tags["api/syscall"] where p.tag == "page" order by p.name ]], templates.pageItem)}

## Space Lua APIs
${template.each(query[[ from p = tags["api/space-lua"] where p.tag == "page" order by p.name ]], templates.pageItem)}

## Lua Standard Library
${template.each(query[[ from p = tags["api/lua"] where p.tag == "page" order by p.name ]], templates.pageItem)}
