#meta

We would like to keep our space clean. These are some tools that help you do that.

# Aspiring pages
This shows page links (max 20 to keep things sensible) that link to a page that does not (yet) exist. These could be broken links or just pages _aspiring_ to be created.

${some(template.each(query[[
  from index.tag "aspiring-page"
  limit 20
]], template.new[==[
    * [[${ref}]]: broken link to [[${name}]]
]==])) or "No aspiring pages, all good!"}

# Conflicting copies
These are pages that have conflicting copies (as a result of sync). Have a look at them as well as their original (non-conflicting) versions and decide which one to keep.

${some(template.each(query[[
  from index.tag "page" where name:find("%.conflicted%.")
]], template.new[==[
    * [[${name:gsub("%.conflicted%..+$", "")}]]: conflict copy [[${name}]]
]==]) or "No conflicting pages!"}
