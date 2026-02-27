local function assertEquals(a, b)
  if a ~= b then
    error(
      "Assertion failed: "
        .. tostring(a) .. " (" .. type(a) .. ")"
        .. " is not equal to "
        .. tostring(b) .. " (" .. type(b) .. ")"
    )
  end
end

local function assertTrue(v, msg)
  if not v then
    error("Assertion failed: " .. (msg or "expected truthy value"))
  end
end

-- Dataset
local pages = {
  { name = "Alice", tags = {"work", "urgent"},     size = 10, age = 31 },
  { name = "Bob",   tags = {"work"},               size = 20, age = 25 },
  { name = "Carol", tags = {"personal", "urgent"}, size =  5, age = 41 },
  { name = "Dave",  tags = {"personal"},           size = 15, age = 52 },
  { name = "Ed",    tags = {},                     size =  3, age = 19 },
  { name = "Fran",  tags = {"random"},             size =  1, age = 55 },
  { name = "Greg",  tags = {"work", "fun"},        size =  2, age = 63 },
}

-- 1. Basic `from` — all rows returned

do
  local r = query [[
    from
      pages
  ]]
  assertEquals(#r, #pages)
end

do
  local r = query [[
    from
      p = pages
  ]]
  assertEquals(#r, #pages)
  assertEquals(r[1].name, "Alice")
end

-- 2. Select / projection

-- 2a. Unbound: bare field names
do
  local r = query [[
    from
      pages
    select {
      n = name,
    }
  ]]
  assertEquals(r[1].n, "Alice")
end

-- 2b. Bound: qualified access
do
  local r = query [[
    from
      p = pages
    select {
      n = p.name,
    }
  ]]
  assertEquals(r[1].n, "Alice")
  assertEquals(r[2].n, "Bob")
end

-- 2c. Unbound: mixed with nil-guard for undefined binding
do
  local r = query [[
    from
      pages
    select {
      a = name,
      b = p and p.tags[1],
    }
  ]]
  assertEquals(r[1].a, "Alice")
end

-- 2d. Select single field (not table constructor)
do
  local r = query [[
    from
      pages
    select
      name
  ]]
  assertEquals(r[1], "Alice")
  assertEquals(r[2], "Bob")
end

-- 2e. Select single field, bound
do
  local r = query [[
    from
      p = pages
    select
      p.name
  ]]
  assertEquals(r[1], "Alice")
  assertEquals(r[2], "Bob")
end

-- 2f. Select with expression
do
  local r = query [[
    from
      pages
    select
      name .. " (" .. size .. ")"
  ]]
  assertEquals(r[1], "Alice (10)")
end

-- 2g. Select with expression, bound
do
  local r = query [[
    from
      p = pages
    select
      p.name .. " (" .. p.size .. ")"
  ]]
  assertEquals(r[1], "Alice (10)")
end

-- 2h. Select whole object via object variable
do
  local r = query [[
    from
      p = pages
    select
      p
  ]]
  assertEquals(r[1].name, "Alice")
  assertEquals(r[1].size, 10)
end

-- 2i. Select table with aliased fields (key ~= value name)
do
  local r = query [[
    from
      pages
    select {
      pageName = name,
      sz = size,
    }
  ]]
  assertEquals(r[1].pageName, "Alice")
  assertEquals(r[1].sz, 10)
end

-- 3. Limit and offset

-- 3a. Limit only
do
  local r = query [[
    from
      pages
    limit
      2
  ]]
  assertEquals(#r, 2)
end

-- 3b. Limit with offset
do
  local r = query [[
    from
      p = pages
    select {
      name = p.name,
    }
    limit
      3, 2
  ]]
  assertEquals(#r, 3)
  assertEquals(r[1].name, "Carol")
end

-- 3c. Large offset reduces result count
do
  local r = query [[
    from
      pages
    limit
      100, 5
  ]]
  assertEquals(#r, 2)
end

-- 3d. Limit 0 returns empty
do
  local r = query [[
    from
      pages
    limit
      0
  ]]
  assertEquals(#r, 0)
end

-- 4. Order by

-- 4a. Order by field, unbound
do
  local r = query [[
    from
      pages
    select {
      name = name,
    }
    order by
      size desc
  ]]
  assertEquals(r[1].name, "Bob")
end

-- 4b. Order by field, bound
do
  local r = query [[
    from
      p = pages
    select {
      age = p.age,
    }
    order by
      p.age
  ]]
  assertEquals(r[1].age, 19)
end

-- 4c. Order by multiple fields
do
  local r = query [[
    from
      p = pages
    select {
      name = p.name,
      size = p.size,
    }
    order by
      p.size, p.name
  ]]
  -- size=1 Fran, size=2 Greg, size=3 Ed, size=5 Carol, ...
  assertEquals(r[1].name, "Fran")
  assertEquals(r[2].name, "Greg")
end

-- 4d. Order by desc + limit
do
  local r = query [[
    from
      p = pages
    order by
      p.age desc
    limit
      1
  ]]
  assertEquals(r[1].name, "Greg") -- age 63
end

-- 5. Where

-- 5a. Where, unbound
do
  local r = query [[
    from
      pages
    where
      size > 10
    select {
      name = name,
    }
  ]]
  assertEquals(#r, 2) -- Bob (20), Dave (15)
  assertEquals(r[1].name, "Bob")
end

-- 5b. Where, bound
do
  local r = query [[
    from
      p = pages
    where
      p.age < 30
    select {
      name = p.name,
    }
  ]]
  assertEquals(r[1].name, "Bob")
  assertEquals(r[2].name, "Ed")
end

-- 5c. Where with truthy check, unbound
do
  local r = query [[
    from
      pages
    where
      name
  ]]
  assertEquals(#r, #pages)
end

-- 5d. Where with nil check on nested field, unbound
do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
  ]]
  -- Ed has empty tags -> tags[1] is nil -> excluded
  assertEquals(#r, 6)
end

-- 5e. Where with nil check, bound
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
  ]]
  assertEquals(#r, 6)
end

-- 5f. Where + order by + limit + select (full pipeline without grouping)
do
  local r = query [[
    from
      p = pages
    where
      p.size > 2
    select {
      name = p.name,
      size = p.size,
    }
    order by
      p.name
    limit
      3
  ]]
  assertEquals(#r, 3)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Bob")
  assertEquals(r[3].name, "Carol")
end

-- 5g. Where + order by + limit, unbound
do
  local r = query [[
    from
      pages
    where
      size > 2
    select {
      name = name,
      size = size,
    }
    order by
      name
    limit
      3
  ]]
  assertEquals(#r, 3)
  assertEquals(r[1].name, "Alice")
end

-- 6. Group by — single key

-- 6a. Group by with where filter, unbound
do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    select {
      key = key,
    }
  ]]
  assertTrue(type(r[1].key) == "string" or r[1].key == nil)
  -- work, personal, random -> 3 groups
  assertEquals(#r, 3)
end

-- 6b. Group by with where filter, bound
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      key = key,
    }
  ]]
  assertEquals(#r, 3)
end

-- 6c. Group by with group access
do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    select {
      k = key,
      gc = #group,
      first = group[1].name,
    }
  ]]
  assertTrue(type(r[1].gc) == "number")
end

-- 6d. Group by bound with group access
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      k = key,
      gc = #group,
      n = group[1].name,
    }
  ]]
  assertTrue(type(r[1].gc) == "number")
end

-- 6e. Group by nil key (Ed has empty tags, tags[1] is nil)
do
  local r = query [[
    from
      pages
    group by
      tags[1]
    select {
      k = key,
      gc = #group,
    }
  ]]
  -- 4 groups: work, personal, random, nil (Ed)
  assertEquals(#r, 4)
end

-- 7. Group by — composite key

-- 7a. Multi-key group by, unbound
do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil and tags[2] ~= nil
    group by
      tags[1], tags[2]
    select {
      k1 = key[1],
      k2 = key[2],
    }
  ]]
  -- Alice: work,urgent; Carol: personal,urgent; Greg: work,fun -> 3 combos
  assertEquals(#r, 3)
end

-- 7b. Multi-key group by, bound
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil and p.tags[2] ~= nil
    group by
      p.tags[1], p.tags[2]
    select {
      k1 = key[1],
      k2 = key[2],
    }
  ]]
  assertEquals(#r, 3)
end

-- 8. Aggregation builtins

-- 8a. count
do
  local r1 = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    select {
      count = count(name),
    }
  ]]
  local r2 = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      count = count(p.name),
    }
  ]]
  assertTrue(type(r1[1].count) == "number")
  assertEquals(#r1, #r2)
end

-- 8b. min, max, avg, sum
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      mn = min(p.size),
      mx = max(p.size),
      av = avg(p.size),
      sm = sum(p.size),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(type(row.mn) == "number" or row.mn == nil)
    assertTrue(type(row.av) == "number" or row.av == nil)
  end
end

-- 8c. array_agg
do
  local r1 = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    select {
      arr = array_agg(name),
    }
  ]]
  local r2 = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      arr = array_agg(p.name),
    }
  ]]
  assertTrue(type(r1[1].arr) == "table" or r1[1].arr == nil)
  assertEquals(#r1, #r2)
end

-- 8d. count() with no argument (counts all rows)
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      k = key,
      n = count(),
    }
  ]]
  assertTrue(type(r[1].n) == "number")
end

-- 8e. Multiple aggregates in one select
do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    select {
      c = count(name),
      lo = min(size),
      hi = max(size),
      av = avg(size),
      sm = sum(size),
      arr = array_agg(name),
    }
  ]]
  assertTrue(type(r[1].c) == "number")
  assertTrue(type(r[1].lo) == "number" or r[1].lo == nil)
  assertTrue(type(r[1].arr) == "table" or r[1].arr == nil)
end

-- 9. Having

-- 9a. Having with aggregate, unbound
do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    having
      count(name) > 1
    select {
      key = key,
    }
  ]]
  -- work: Alice,Bob,Greg (3); personal: Carol,Dave (2); random: Fran (1)
  -- Only work and personal pass
  assertEquals(#r, 2)
end

-- 9b. Having with aggregate, bound
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    having
      count(p.name) > 1
    select {
      key = key,
    }
  ]]
  assertEquals(#r, 2)
end

-- 9c. Having with sum
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    having
      sum(p.size) > 15
    select {
      key = key,
    }
  ]]
  -- work: 10+20+2=32; personal: 5+15=20; random: 1
  -- work and personal pass
  assertEquals(#r, 2)
end

-- 9d. Having without group by (acts as secondary filter), unbound
do
  local r = query [[
    from
      pages
    having
      size > 10
    select {
      name = name,
    }
  ]]
  assertEquals(#r, 2) -- Bob (20), Dave (15)
end

-- 9e. Having without group by, bound
do
  local r = query [[
    from
      p = pages
    having
      p.size > 10
    select {
      name = p.name,
    }
  ]]
  assertEquals(#r, 2)
end

-- 9f. Where + having without group by (both filter)
do
  local r = query [[
    from
      pages
    where
      age > 20
    having
      size > 10
    select {
      name = name,
    }
  ]]
  -- age>20: Alice(31),Bob(25),Carol(41),Dave(52),Fran(55),Greg(63)
  -- size>10: Bob(20),Dave(15)
  assertEquals(#r, 2)
  assertEquals(r[1].name, "Bob")
  assertEquals(r[2].name, "Dave")
end

-- 10. Group by + having + order by + select + limit (full pipeline)

-- 10a. Bound
do
  local r = query [[
    from
      p = pages
    where
      p.age > 20
    group by
      p.tags[1]
    having
      min(p.age) > 25
    select {
      tag = key,
      top = max(p.name),
      total = count(p.name),
      sum_size = sum(p.size),
      avg_size = avg(p.size),
    }
    order by
      avg_size desc
    limit
      2
  ]]
  assertTrue(#r <= 2)
  assertTrue(type(r[1].avg_size) == "number" or r[1].avg_size == nil)
end

-- 10b. Unbound
do
  local r = query [[
    from
      pages
    where
      age > 20
    group by
      tags[1]
    having
      min(age) > 25
    select {
      tag = key,
      top = max(name),
      total = count(name),
      sum_size = sum(size),
      avg_size = avg(size),
    }
    order by
      avg_size desc
    limit
      2
  ]]
  assertTrue(#r <= 2)
end

-- 11. Distinct

-- 11a. Distinct with select, unbound
do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
    select {
      tag = tags[1],
    }
  ]]
  -- default distinct=true for queries, so should deduplicate
  -- work appears 3x, personal 2x, random 1x -> 3 distinct
  assertEquals(#r, 3)
end

-- 11b. Distinct with select, bound
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    select {
      tag = p.tags[1],
    }
  ]]
  assertEquals(#r, 3)
end

-- 12. Edge cases: empty results

-- 12a. Where that matches nothing
do
  local r = query [[
    from
      pages
    where
      size > 1000
  ]]
  assertEquals(#r, 0)
end

-- 12b. Having that matches nothing
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    having
      count(p.name) > 100
    select {
      key = key,
    }
  ]]
  assertEquals(#r, 0)
end

-- 12c. Empty source
do
  local empty = {}
  local r = query [[
    from
      empty
  ]]
  assertEquals(#r, 0)
end

-- 13. Group by + order by on aggregate result

-- 13a. Order by count desc
do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    select {
      tag = key,
      n = count(),
    }
    order by
      n desc
  ]]
  -- work=3, personal=2, random=1
  assertTrue(r[1].n >= r[2].n)
end

-- 13b. Order by key
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      tag = key,
      n = count(),
    }
    order by
      tag
  ]]
  -- alphabetical: personal, random, work
  assertEquals(r[1].tag, "personal")
  assertEquals(r[2].tag, "random")
  assertEquals(r[3].tag, "work")
end

-- 14. Group by key name binding

-- 14a. Single key name available via key variable in select
do
  local found_tag = false
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    select {
      k = key,
    }
  ]]
  for _, row in ipairs(r) do
    if row.k == "work" then
      found_tag = true
    end
  end
  assertTrue(found_tag, "expected to find 'work' group key")
end

-- 15. Caller-injected env variable must not be shadowed by item fields
--     (the requeueTimeouts / mq pattern)

do
  local threshold = 100
  local items = {
    { id = "a", ts = 50 },
    { id = "b", ts = 200 },
  }
  -- m.ts < ts where ts=threshold from parent env
  -- m.ts=50 < 100 -> true; m.ts=200 < 100 -> false
  local ts = threshold
  local r = query [[
    from
      m = items
    where
      m.ts < ts
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].id, "a")
end

-- 16. Unbound: item fields shadow outer locals

do
  local size = 999 -- this should be shadowed by item.size
  local r = query [[
    from
      pages
    where
      size < 10
    select {
      name = name,
      sz = size,
    }
  ]]
  -- size < 10: Carol(5), Ed(3), Fran(1), Greg(2) -> 4 items
  assertEquals(#r, 4)
  assertTrue(r[1].sz < 10)
end

-- 17. Bound: outer locals are accessible

do
  local threshold = 10
  local r = query [[
    from
      p = pages
    where
      p.size > threshold
    select {
      name = p.name,
    }
  ]]
  -- size > 10: Bob(20), Dave(15) -> 2
  assertEquals(#r, 2)
end

-- 18. Select with table constructor + non-Variable expressions

-- 18a. Expression value in PropField
do
  local r = query [[
    from
      p = pages
    select {
      label = p.name .. "!",
      double = p.size * 2,
    }
    limit
      2
  ]]
  assertEquals(r[1].label, "Alice!")
  assertEquals(r[1].double, 20)
  assertEquals(r[2].label, "Bob!")
  assertEquals(r[2].double, 40)
end

-- 18b. Unbound expression
do
  local r = query [[
    from
      pages
    select {
      label = name .. "!",
      double = size * 2,
    }
    limit
      2
  ]]
  assertEquals(r[1].label, "Alice!")
  assertEquals(r[1].double, 20)
end

-- 19. Order by + group by + having + limit combined

do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    having
      count() > 0
    select {
      tag = key,
      total = sum(p.size),
    }
    order by
      total desc
    limit
      2
  ]]
  assertEquals(#r, 2)
  assertTrue(r[1].total >= r[2].total)
end

-- 20. Offset with group by

do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      tag = key,
      n = count(),
    }
    order by
      tag
    limit
      2, 1
  ]]
  -- 3 groups sorted by tag, skip 1, take 2
  assertEquals(#r, 2)
end

-- 21. Where + having + group by combined

do
  local r = query [[
    from
      pages
    where
      age > 20
    group by
      tags[1]
    having
      #group > 1
    select {
      tag = key,
      gc = #group,
    }
  ]]
  -- After where (age>20): Alice(31),Bob(25),Carol(41),Dave(52),Fran(55),Greg(63)
  -- Groups by tags[1]: work=[Alice,Bob,Greg](3), personal=[Carol,Dave](2), random=[Fran](1)
  -- Having #group>1: work(3), personal(2)
  assertEquals(#r, 2)
end

-- Same, bound
do
  local r = query [[
    from
      p = pages
    where
      p.age > 20
    group by
      p.tags[1]
    having
      #group > 1
    select {
      tag = key,
      gc = #group,
    }
  ]]
  assertEquals(#r, 2)
end

-- 22. Select _ (the whole item, unbound)

do
  local r = query [[
    from
      pages
    select
      _
    limit
      1
  ]]
  assertEquals(r[1].name, "Alice")
  assertEquals(r[1].size, 10)
end

-- 23. Group by with order by on key

do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      tag = key,
    }
    order by
      key
  ]]
  assertEquals(r[1].tag, "personal")
  assertEquals(r[2].tag, "random")
  assertEquals(r[3].tag, "work")
end

-- 24. Aggregate on entire dataset (single group)

do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      total = count(),
      min_size = min(p.size),
      max_size = max(p.size),
      sum_size = sum(p.size),
    }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].total, 7)
  assertEquals(r[1].min_size, 1)
  assertEquals(r[1].max_size, 20)
  assertEquals(r[1].sum_size, 56) -- 10+20+5+15+3+1+2
end

-- 25. Nested field access in group by

do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    select {
      k = key,
      first_name = group[1].name,
      first_tag2 = group[1].tags[2],
    }
  ]]
  assertTrue(type(r[1].k) == "string" or r[1].k == nil)
end

-- 26. Mixed aggregate and non-aggregate in select

do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    select {
      c = count(name),
      v = min(size),
      x = p and count(p.name),
    }
  ]]
  assertTrue(type(r[1].c) == "number")
end

-- 27. Having with #group

do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    having
      #group >= 2
    select {
      tag = key,
      gc = #group,
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(row.gc >= 2, "expected group count >= 2, got " .. tostring(row.gc))
  end
end

-- 28. Order by desc on aggregate

do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      tag = key,
      sm = sum(p.size),
    }
    order by
      sm desc
  ]]
  for i = 1, #r - 1 do
    assertTrue(
      (r[i].sm or 0) >= (r[i + 1].sm or 0),
      "expected descending sum order"
    )
  end
end

-- 29. Singleton collection (single object, not array)

do
  local item = { name = "solo", size = 42 }
  local r = query [[
    from
      item
    select {
      name = name,
      size = size,
    }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].name, "solo")
  assertEquals(r[1].size, 42)
end

do
  local item = { name = "solo", size = 42 }
  local r = query [[
    from
      p = item
    select {
      name = p.name,
      size = p.size,
    }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].name, "solo")
end

-- 30. Where on singleton

do
  local item = { name = "solo", size = 42 }
  local r = query [[
    from
      item
    where
      size > 100
  ]]
  assertEquals(#r, 0)
end

do
  local item = { name = "solo", size = 42 }
  local r = query [[
    from
      item
    where
      size > 10
    select {
      name = name,
    }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].name, "solo")
end

-- 31. Where with comparison operators

do
  local r = query [[
    from
      pages
    where
      size == 10
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].name, "Alice")
end

do
  local r = query [[
    from
      pages
    where
      size >= 15
  ]]
  assertEquals(#r, 2) -- Bob(20), Dave(15)
end

do
  local r = query [[
    from
      pages
    where
      size <= 3
  ]]
  assertEquals(#r, 3) -- Ed(3), Fran(1), Greg(2)
end

-- 32. Where with logical operators

do
  local r = query [[
    from
      pages
    where
      size > 10 and age < 40
  ]]
  -- Bob: size=20, age=25 -> true
  assertEquals(#r, 1)
  assertEquals(r[1].name, "Bob")
end

do
  local r = query [[
    from
      pages
    where
      size > 15 or age > 60
  ]]
  -- Bob: size=20 -> true; Greg: age=63 -> true
  assertEquals(#r, 2)
end

do
  local r = query [[
    from
      p = pages
    where
      p.size > 10 and p.age < 40
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].name, "Bob")
end

-- 33. Where with not

do
  local r = query [[
    from
      pages
    where
      not (size > 10)
  ]]
  -- size <= 10: Alice(10), Carol(5), Ed(3), Fran(1), Greg(2) -> 5
  assertEquals(#r, 5)
end

-- 34. Order by with nulls

do
  local data = {
    { name = "a", val = 3 },
    { name = "b" },
    { name = "c", val = 1 },
  }
  local r = query [[
    from
      p = data
    select {
      name = p.name,
    }
    order by
      p.val
  ]]
  -- nulls sort last in ascending
  assertEquals(r[1].name, "c")
  assertEquals(r[2].name, "a")
  assertEquals(r[3].name, "b")
end

-- 35. Select preserves order after where + order by

do
  local r = query [[
    from
      p = pages
    where
      p.size >= 5
    select {
      name = p.name,
      size = p.size,
    }
    order by
      p.size
  ]]
  -- size >= 5: Carol(5), Alice(10), Dave(15), Bob(20) in order
  assertEquals(r[1].name, "Carol")
  assertEquals(r[2].name, "Alice")
  assertEquals(r[3].name, "Dave")
  assertEquals(r[4].name, "Bob")
end

-- 36. Multiple group by keys produce composite key table

do
  local data = {
    { a = "x", b = 1, v = 10 },
    { a = "x", b = 1, v = 20 },
    { a = "x", b = 2, v = 30 },
    { a = "y", b = 1, v = 40 },
  }
  local r = query [[
    from
      p = data
    group by
      p.a, p.b
    select {
      ka = key[1],
      kb = key[2],
      total = sum(p.v),
    }
    order by
      ka, kb
  ]]
  assertEquals(#r, 3) -- (x,1), (x,2), (y,1)
  assertEquals(r[1].ka, "x")
  assertEquals(r[1].kb, 1)
  assertEquals(r[1].total, 30) -- 10+20
  assertEquals(r[2].ka, "x")
  assertEquals(r[2].kb, 2)
  assertEquals(r[2].total, 30)
  assertEquals(r[3].ka, "y")
  assertEquals(r[3].total, 40)
end

-- 37. Having on composite group by

do
  local data = {
    { a = "x", b = 1, v = 10 },
    { a = "x", b = 1, v = 20 },
    { a = "x", b = 2, v = 30 },
    { a = "y", b = 1, v = 40 },
  }
  local r = query [[
    from
      p = data
    group by
      p.a, p.b
    having
      count() > 1
    select {
      ka = key[1],
      kb = key[2],
      n = count(),
    }
  ]]
  -- Only (x,1) has 2 items
  assertEquals(#r, 1)
  assertEquals(r[1].ka, "x")
  assertEquals(r[1].kb, 1)
  assertEquals(r[1].n, 2)
end

-- 38. Bound: select p returns full item

do
  local r = query [[
    from
      p = pages
    select
      p
    limit
      1
  ]]
  assertEquals(r[1].name, "Alice")
  assertEquals(r[1].age, 31)
  assertEquals(r[1].size, 10)
end

-- 39. Numeric aggregates with bound and unbound

do
  local nums = {
    { val = 10 },
    { val = 20 },
    { val = 30 },
  }
  local r = query [[
    from
      nums
    group by
      "all"
    select {
      mn = min(val),
      mx = max(val),
      av = avg(val),
      sm = sum(val),
      ct = count(),
    }
  ]]
  assertEquals(r[1].mn, 10)
  assertEquals(r[1].mx, 30)
  assertEquals(r[1].av, 20)
  assertEquals(r[1].sm, 60)
  assertEquals(r[1].ct, 3)
end

do
  local nums = {
    { val = 10 },
    { val = 20 },
    { val = 30 },
  }
  local r = query [[
    from
      n = nums
    group by
      "all"
    select {
      mn = min(n.val),
      mx = max(n.val),
      av = avg(n.val),
      sm = sum(n.val),
      ct = count(),
    }
  ]]
  assertEquals(r[1].mn, 10)
  assertEquals(r[1].mx, 30)
  assertEquals(r[1].av, 20)
  assertEquals(r[1].sm, 60)
  assertEquals(r[1].ct, 3)
end
