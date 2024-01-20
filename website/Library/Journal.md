This library contains some useful page templates for journalers. Want to easily create a daily or weekly note? These templates can get you started. Instantiate them via {[Page: From Template]}. 

# Installation
To import this library, run the {[Library: Import]} command in your SilverBullet space and enter:

    !silverbullet.md/Library/Journal/

# Included templates
```query
page
where name =~ /^{{escapeRegexp @page.name}}\//
render [[Library/Core/Query/Page]]
```

# Tips
Do you want your space’s start page to always be either your daily or weekly note? You can!

To set the _daily note_ as the default page, set the following in [[SETTINGS]]:

```yaml
indexPage: "Journal/Day/{{today}}"
```

And for the _weekly note_:

```yaml
indexPage: "Journal/Week/{{weekStart}}"
```
