---
tags: meta/library
---
Welcome to SilverBullet’s standard library. This library (all pages under `Library/Std`) ship with SilverBullet itself. Therefore, you will not find these pages in your space folder, even though they _appear_ to be located there. These pages are all read-only, so you cannot (directly) modify them.

The goal of the standard library is provide a base-level of useful commands, slash commands, page templates and scripts.

The remainder of this page documents what's included.

# Config
SilverBullet is configured via the [config APIs](https://silverbullet.md/API/config). Built-in configuration options and their default values are defined in [[^Library/Std/Config]].

# Page templates
Page templates can be triggered via the ${widgets.commandButton "Page: From Template"} command (some of them have command or keyboard shortcuts) and provide a convenient way to create pages of a certain type. You can create your own page templates using the [[^Library/Std/Page Templates/Page Template]] template.

The following page templates are part of the standard library:
${template.each(query[[
  from index.tag "page"
  where name:startsWith("Library/Std/Page Templates/")
]], template.new[==[
    * [[${_.name}]]: ${_.description}
]==])}

# Slash templates
Slash templates provide a quick way to insert frequently used snippets of code. You can create your own using the [[^Library/Std/Page Templates/Slash Template]] page template.

The following slash templates are part of the standard library:
${template.each(query[[
  from index.tag "page"
  where name:startsWith("Library/Std/Slash Templates/")
]], template.new[==[
    * [[${_.name}]]: ${_.description}
]==])}

# Meta pages 
The SilverBullet ships with a few generally useful meta pages (pages tagged with `#meta`) you can use:

${template.each(query[[
  from index.tag "page"
  where name:startsWith("Library/Std/Pages/")
]], templates.pageItem)}

# Infrastructure
Core functionality that is implemented using Space Lua:
${template.each(query[[
  from index.tag "page"
  where name:startsWith("Library/Std/Infrastructure/")
]], template.new[==[
    * [[${_.name}]]: ${_.description}
]==])}

# APIs
Whereas a lot of APIs in SilverBullet are built in, some of them have been implemented Space Lua:
${template.each(query[[
  from index.tag "page"
  where name:startsWith("Library/Std/APIs/")
]], templates.pageItem)}

# Editor support
Some editor features have been implemented in Space Lua:
${template.each(query[[
  from index.tag "page"
  where name:startsWith("Library/Std/Editor/")
]], templates.pageItem)}
