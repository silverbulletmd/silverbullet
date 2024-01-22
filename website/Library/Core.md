This library is highly recommended for everybody to import immediately. It provides a lot of functionality you’ll likely appreciate (and may be used to having out of the box, if you’re longer-term SilverBullet user).

Some examples:
* [[Table of Contents]] and [[Linked Mentions]]
* All the slash commands you know and love, ranging from `/h1` to `/task` to `/table` to `/code` to `/query` to `/template` to `/today` to...
* Some useful general purpose pages such as [[Library/Core/Page/Maintenance]], [[Library/Core/Quick Notes]] and [[Library/Core/Page/Template Index]].

# Installation
To import this library, run the {[Library: Import]} command in your SilverBullet space and enter:

    !silverbullet.md/Library/Core/

# Included templates
```query
template
where name =~ /^{{escapeRegexp @page.name}}\//
render [[Library/Core/Query/Template]]
```

# Included utility pages
```query
page
where name =~ /^{{escapeRegexp @page.name}}\// and tags != "template"
render [[Library/Core/Query/Page]]
```
