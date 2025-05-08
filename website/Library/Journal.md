This [[Libraries|library]] contains some useful page templates for journalers. Want to easily create a daily or weekly note? These templates can get you started. Instantiate them via {[Page: From Template]}. 

# Installation
In your [[SETTINGS]] list the following under `libraries:`
```yaml
libraries:
- import: "[[!v1.silverbullet.md/Library/Journal/*]]"
```
Then run the {[Libraries: Update]} command to install it.

See [[Libraries#Configuring libraries]] for more details.

# Included templates
```query
page
where name =~ /^{{escapeRegexp(@page.name)}}\//
render [[Library/Core/Query/Page]]
```
