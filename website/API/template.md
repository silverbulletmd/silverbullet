Template functions that use the [[API/global#tpl(template)]] function.

## template.each(collection, template)
Iterates over a collection and renders a template for each item.

Example:

${template.each(query[[from tag "page" limit 3]], tpl[==[
    * ${name}
]==])}