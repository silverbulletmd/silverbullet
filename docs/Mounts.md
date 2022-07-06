Space mounting in `MOUNTS`

```yaml
- path: file:/Users/zef/git/blog
  prefix: 📖
  perm: ro,rw #default rw
```

Features
* Auto translates internal wiki links (prefixes with prefix) and removes prefix upon save

To do:
* [ ] Handle queries
  * `page` and `link` query needs to dynamically add/remove a `and name =~ /^🚪 PREFIX/` clause)
  * `task` same but with `page` check

* Due to namespacing, the mounted space needs to be namespaced somehow
* Could be an emoji, could be a page prefix (now using `name`)
* On the fly link rewriting on read and write with prefix
* Will require an actual set of `fs` syscalls:
  * readFile(path)
  * writeFile(path, text)
  * listFiles(path) with stat-like results (at least enough for `PageMeta` responses)
* If this exists, should not all disk file access work through plugs as well and have that abstraction happen at this level?

protocols:
* file:
* http/https with “password” field for authentication