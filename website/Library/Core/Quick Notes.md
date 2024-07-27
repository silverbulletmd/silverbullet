This is your {[Quick Note]} inbox.
    
```query
page
  where name =~ /^Inbox\//
  render [[Library/Core/Query/Full Page]]
  order by lastModified desc
```
