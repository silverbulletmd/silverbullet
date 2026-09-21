#meta/api

Implements the API for defining identities addressable with `@name`.

# API

## identity.define(def)
Defines an identity. Options:
* `name` _(required)_: the name it is addressed by, without the `@`. Matched case-insensitively.
* `description`: shown beside the name in autocomplete.

Accounts with access to the space are identities already and need no definition. Use this for teams, projects, agents — anything addressable that is not an account.

## identity.own()
Returns the identity the current user is, as `{ name, id, detail? }`, or nil when the space does not know. On an owner-only deployment without account usernames, this is `self` with the ID `@self`.

## identity.mentions(recipient?, options?)
Returns open mentions and page-level recipients from the current index. `recipient` accepts a name with or without `@`, matched case-insensitively; omit it to list all recipients. Completed tasks are excluded. Signatures and code examples do not create addressing mentions.

`options.limit` bounds the result; omitted means all matches. `options.offset` skips matches (default `0`). Results are sorted by page, UTF-16 position, and target identity. The returned table contains `recipient` (when filtered), `mentions`, `total` (before pagination), and `truncated` (more matches remain after this page).

Each entry has `kind` (`mention` or `page`), `page`, `ref`, `target`, `snippet`, `by` (author names), and optional `replyTo`. Inline mentions also carry `range`, `pos`, `nickname`, `fromTag`, and `inComment`. `replyTo` is the first signed author, falling back to the current user's identity; it is absent when neither is known. Page-level recipients use that fallback; inspect page authorship before replying. Authorship is self-declared, not authenticated identity. References and offsets can become stale after edits.

```lua
identity.mentions("helper", {limit = 100, offset = 0})
```

# Example
```lua
identity.define {
  name        = "sales",
  description = "Sales team",
}
```

# Implementation

```space-lua
-- priority: 50
identity = identity or {}

function identity.define(spec)
  config.set({"identities", spec.name}, spec)
end

-- The identity the current user is, or nil when the space does not know.
-- An anonymous reader of a public space is nobody; owner-only deployments
-- without account usernames use self.
function identity.own()
  local me
  for _, account in ipairs(system.listAccounts()) do
    if account.me then
      me = account.username and account.username:lower() or "self"
    end
  end
  if not me then return end
  for _, r in ipairs(system.invokeFunction("index.listIdentities")) do
    if r.name:lower() == me then return r end
  end
end

--- Lists open addressed mentions and page recipients from the index.
-- @param recipient string Optional identity name, with or without @; omitted lists all recipients.
-- @param options table Optional limit (positive integer) and offset (nonnegative integer).
-- @return table Paginated mentions, total count, and whether more matches remain.
function identity.mentions(recipient, options)
  local target
  if recipient ~= nil then
    assert(type(recipient) == "string", "invalid recipient")
    local normalized = recipient:gsub("^@", "")
    assert(normalized ~= "" and not normalized:find("[%s%c@]"), "invalid recipient")
    target = "@" .. normalized:lower()
  end
  options = options or {}
  assert(type(options) == "table", "options must be a table")
  local limit = options.limit
  local offset = options.offset or 0
  assert(limit == nil or (type(limit) == "number" and limit >= 1 and limit % 1 == 0), "limit must be a positive integer")
  assert(type(offset) == "number" and offset >= 0 and offset % 1 == 0, "offset must be a nonnegative integer")
  local names = {}
  for _, entry in ipairs(system.invokeFunction("index.listIdentities")) do
    names[entry.id] = entry.name
  end
  local own = identity.own()
  local fallback = own and own.name or nil
  local mentions = {}
  for _, m in ipairs(query[[from r = index.relations("at-mention") select r]]) do
    if not target or m.to == target then
      local task = m.fromTag == "task" and index.getObjectByRef(m.page, "task", m.from) or nil
      if not (task and task.done) then
        local authors = {}
        for _, author in ipairs(m.by or {}) do
          table.insert(authors, names[author] or author:gsub("^@", ""))
        end
        local pos = m.range and m.range[1] or nil
        table.insert(mentions, {
          kind = "mention",
          target = m.to,
          range = m.range,
          nickname = m.alias,
          page = m.page,
          ref = pos and (m.page .. "@" .. tostring(pos)) or m.from,
          pos = pos,
          snippet = m.snippet,
          fromTag = m.fromTag,
          inComment = m.inComment or false,
          by = authors,
          replyTo = authors[1] or fallback,
        })
      end
    end
  end
  for _, relation in ipairs(query[[from r = index.relations("recipients") where r.toTag == "identity" select r]]) do
    if not target or relation.to == target then
      table.insert(mentions, {
        kind = "page",
        target = relation.to,
        nickname = relation.alias,
        by = {},
        page = relation.page,
        ref = relation.page,
        snippet = relation.snippet,
        replyTo = fallback,
      })
    end
  end
  table.sort(mentions, function(a, b)
    if a.page ~= b.page then return a.page < b.page end
    if (a.pos or -1) ~= (b.pos or -1) then
      return (a.pos or -1) < (b.pos or -1)
    end
    return a.target < b.target
  end)
  local out = {}
  for i = offset + 1, math.min(offset + (limit or #mentions), #mentions) do
    table.insert(out, mentions[i])
  end
  return {recipient = target, mentions = out, total = #mentions, truncated = offset + #out < #mentions}
end
```
