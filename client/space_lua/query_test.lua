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

-- 40. Order by with nulls — default behavior

do
  local data = {
    { name = "alice", priority = 10 },
    { name = "bob" },
    { name = "carol", priority = 50 },
    { name = "dave" },
    { name = "eve", priority = 1 },
  }

  -- 40a. asc default: nulls last
  local r1 = query [[
    from
      p = data
    select { name = p.name }
    order by
      p.priority
  ]]
  assertEquals(r1[1].name, "eve")
  assertEquals(r1[2].name, "alice")
  assertEquals(r1[3].name, "carol")
  -- nulls at end (bob and dave, order between them is unspecified)
  assertTrue(r1[4].name == "bob" or r1[4].name == "dave", "expected null-priority item")
  assertTrue(r1[5].name == "bob" or r1[5].name == "dave", "expected null-priority item")

  -- 40b. desc default: nulls first
  local r2 = query [[
    from
      p = data
    select { name = p.name }
    order by
      p.priority desc
  ]]
  assertTrue(r2[1].name == "bob" or r2[1].name == "dave", "expected null-priority item")
  assertTrue(r2[2].name == "bob" or r2[2].name == "dave", "expected null-priority item")
  assertEquals(r2[3].name, "carol")
  assertEquals(r2[4].name, "alice")
  assertEquals(r2[5].name, "eve")
end

-- 41. Order by with explicit nulls last / nulls first

do
  local data = {
    { name = "alice", priority = 10 },
    { name = "bob" },
    { name = "carol", priority = 50 },
    { name = "dave" },
    { name = "eve", priority = 1 },
  }

  -- 41a. desc nulls last (override default)
  local r3 = query [[
    from
      p = data
    select { name = p.name }
    order by
      p.priority desc nulls last
  ]]
  assertEquals(r3[1].name, "carol")
  assertEquals(r3[2].name, "alice")
  assertEquals(r3[3].name, "eve")
  assertTrue(r3[4].name == "bob" or r3[4].name == "dave", "expected null-priority item")
  assertTrue(r3[5].name == "bob" or r3[5].name == "dave", "expected null-priority item")

  -- 41b. asc nulls first (override default)
  local r4 = query [[
    from
      p = data
    select { name = p.name }
    order by
      p.priority asc nulls first
  ]]
  assertTrue(r4[1].name == "bob" or r4[1].name == "dave", "expected null-priority item")
  assertTrue(r4[2].name == "bob" or r4[2].name == "dave", "expected null-priority item")
  assertEquals(r4[3].name, "eve")
  assertEquals(r4[4].name, "alice")
  assertEquals(r4[5].name, "carol")
end

-- 42. Order by nulls with unbound access

do
  local data = {
    { name = "a", val = 3 },
    { name = "b" },
    { name = "c", val = 1 },
  }

  -- 42a. desc nulls last, unbound
  local r = query [[
    from
      data
    select { name = name }
    order by
      val desc nulls last
  ]]
  assertEquals(r[1].name, "a")
  assertEquals(r[2].name, "c")
  assertEquals(r[3].name, "b")

  -- 42b. asc nulls first, unbound
  local r2 = query [[
    from
      data
    select { name = name }
    order by
      val nulls first
  ]]
  assertEquals(r2[1].name, "b")
  assertEquals(r2[2].name, "c")
  assertEquals(r2[3].name, "a")
end

-- 43. Order by nulls with multiple keys

do
  local data = {
    { name = "a", x = 1, y = 10 },
    { name = "b", x = 1 },
    { name = "c", x = 2, y = 5 },
    { name = "d", x = 2 },
  }

  local r = query [[
    from
      p = data
    select { name = p.name }
    order by
      p.x, p.y nulls first
  ]]
  assertEquals(r[1].name, "b")
  assertEquals(r[2].name, "a")
  assertEquals(r[3].name, "d")
  assertEquals(r[4].name, "c")
end

-- 44. Explicit asc keyword (same as default)

do
  local r = query [[
    from
      p = pages
    select { name = p.name }
    order by
      p.size asc
    limit
      2
  ]]
  assertEquals(r[1].name, "Fran")
  assertEquals(r[2].name, "Greg")
end

-- 45. Count with filter

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
      total = count(),
      big = count(p.name) filter(where p.size > 10),
    }
    order by
      tag
  ]]
  -- personal: Carol(5),Dave(15) -> big=1 (Dave)
  -- random: Fran(1) -> big=0
  -- work: Alice(10),Bob(20),Greg(2) -> big=1 (Bob)
  assertEquals(#r, 3)
  for _, row in ipairs(r) do
    if row.tag == "personal" then
      assertEquals(row.big, 1)
      assertEquals(row.total, 2)
    elseif row.tag == "random" then
      assertEquals(row.big, 0)
      assertEquals(row.total, 1)
    elseif row.tag == "work" then
      assertEquals(row.big, 1)
      assertEquals(row.total, 3)
    end
  end
end

-- 46. Sum with filter

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
      total_size = sum(p.size),
      big_size = sum(p.size) filter(where p.size > 5),
    }
    order by
      tag
  ]]
  for _, row in ipairs(r) do
    if row.tag == "work" then
      -- Alice(10)+Bob(20)+Greg(2)=32 total, big: 10+20=30
      assertEquals(row.total_size, 32)
      assertEquals(row.big_size, 30)
    elseif row.tag == "personal" then
      -- Carol(5)+Dave(15)=20 total, big: 15
      assertEquals(row.total_size, 20)
      assertEquals(row.big_size, 15)
    elseif row.tag == "random" then
      -- Fran(1) total=1, big: 0 (none pass)
      assertEquals(row.total_size, 1)
      assertEquals(row.big_size, 0)
    end
  end
end

-- 47. Min/max with filter

do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      min_big = min(p.size) filter(where p.size > 5),
      max_small = max(p.size) filter(where p.size <= 5),
    }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].min_big, 10)   -- smallest > 5: Alice(10)
  assertEquals(r[1].max_small, 5)  -- largest <= 5: Carol(5)
end

-- 48. Avg with filter

do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      avg_all = avg(p.size),
      avg_big = avg(p.size) filter(where p.size >= 10),
    }
  ]]
  assertEquals(#r, 1)
  -- all: (10+20+5+15+3+1+2)/7 = 56/7 = 8
  assertEquals(r[1].avg_all, 8)
  -- big (>=10): (10+20+15)/3 = 45/3 = 15
  assertEquals(r[1].avg_big, 15)
end

-- 49. Array_agg with filter

do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      all_names = array_agg(p.name),
      big_names = array_agg(p.name) filter(where p.size > 10),
    }
  ]]
  assertEquals(#r, 1)
  assertEquals(#r[1].all_names, 7)
  -- size > 10: Bob(20), Dave(15)
  assertEquals(#r[1].big_names, 2)
end

-- 50. Unbound access in filter

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
      big = count(name) filter(where size > 10),
    }
    order by
      tag
  ]]
  for _, row in ipairs(r) do
    if row.tag == "work" then
      assertEquals(row.big, 1) -- Bob(20)
    end
  end
end

-- 51. Count without argument with filter

do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      total = count(),
      big = count() filter(where p.size > 10),
    }
  ]]
  assertEquals(r[1].total, 7)
  assertEquals(r[1].big, 2) -- Bob(20), Dave(15)
end

-- 52. Filter that matches nothing

do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      n = count() filter(where p.size > 1000),
      s = sum(p.size) filter(where p.size > 1000),
    }
  ]]
  assertEquals(r[1].n, 0)
  assertEquals(r[1].s, 0)
end

-- 53. Multiple filters in one select

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
      young = count(p.name) filter(where p.age < 30),
      old = count(p.name) filter(where p.age >= 50),
    }
    order by
      tag
  ]]
  for _, row in ipairs(r) do
    if row.tag == "work" then
      -- young: Bob(25) -> 1; old: Greg(63) -> 1
      assertEquals(row.young, 1)
      assertEquals(row.old, 1)
    elseif row.tag == "personal" then
      -- young: none; old: Dave(52) -> 1
      assertEquals(row.young, 0)
      assertEquals(row.old, 1)
    elseif row.tag == "random" then
      -- young: none; old: Fran(55) -> 1
      assertEquals(row.young, 0)
      assertEquals(row.old, 1)
    end
  end
end

-- 54. `using` with named function comparator

local function reverseAlpha(a, b)
  return a > b
end

do
  local r = query [[
    from
      p = pages
    order by
      p.name using reverseAlpha
    select p.name
  ]]
  assertEquals(r[1], "Greg")
  assertEquals(r[#r], "Alice")
end

-- 55. `using` with inline anonymous function

do
  local r = query [[
    from
      p = pages
    order by
      p.size using function(a, b) return a > b end
    select { name = p.name, size = p.size }
  ]]
  assertEquals(r[1].name, "Bob")   -- size 20
  assertEquals(r[2].name, "Dave")  -- size 15
end

-- 56. `using` with `nulls last`

do
  local r = query [[
    from
      p = pages
    order by
      p.tags[1] using function(a, b) return a < b end nulls last
    select { name = p.name, tag = p.tags[1] }
  ]]
  assertEquals(r[#r].name, "Ed")
end

-- 57. `using` with `nulls first`

do
  local r = query [[
    from
      p = pages
    order by
      p.tags[1] using function(a, b) return a < b end nulls first
    select { name = p.name, tag = p.tags[1] }
  ]]
  assertEquals(r[1].name, "Ed")
end

-- 58. `using` named function with `nulls last`

do
  local r = query [[
    from
      p = pages
    order by
      p.tags[1] using reverseAlpha nulls last
    select { name = p.name, tag = p.tags[1] }
  ]]
  assertEquals(r[#r].name, "Ed")
  assertEquals(r[1].tag, "work")
end

-- 59. `using` anonymous function with `nulls first`

do
  local r = query [[
    from
      p = pages
    order by
      p.tags[1] using function(a, b) return a < b end nulls first
    select { name = p.name, tag = p.tags[1] }
  ]]
  assertEquals(r[1].name, "Ed")
end

-- 60. `using` on one key, normal on another

do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    order by
      p.tags[1] using reverseAlpha,
      p.name
    select { tag = p.tags[1], name = p.name }
  ]]
  assertEquals(r[1].tag, "work")
  assertEquals(r[1].name, "Alice")
end

-- 61. Multiple keys with mixed using and desc

do
  local data = {
    { name = "a", x = 2, y = 10 },
    { name = "b", x = 1, y = 20 },
    { name = "c", x = 2, y = 5 },
    { name = "d", x = 1, y = 15 },
  }
  local r = query [[
    from
      p = data
    order by
      p.x using function(a, b) return a < b end,
      p.y desc
    select { name = p.name }
  ]]
  assertEquals(r[1].name, "b")
  assertEquals(r[2].name, "d")
  assertEquals(r[3].name, "a")
  assertEquals(r[4].name, "c")
end

-- 62. `using` anonymous function with `nulls first`

do
  local data = {
    { name = "a", val = 3 },
    { name = "b" },
    { name = "c", val = 1 },
  }
  local r = query [[
    from
      p = data
    order by
      p.val using function(a, b) return a > b end nulls first
    select { name = p.name }
  ]]
  assertEquals(r[1].name, "b")
  assertEquals(r[2].name, "a")
  assertEquals(r[3].name, "c")
end

-- 63. `using` with group by + aggregate order

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
      n using function(a, b) return a > b end
  ]]
  assertEquals(r[1].tag, "work")
  assertEquals(r[1].n, 3)
  assertEquals(r[#r].n, 1)
end

-- 64. `using` named function in unbound mode

do
  local function byLen(a, b)
    return #a < #b
  end
  local r = query [[
    from
      pages
    order by
      name using byLen
    select name
  ]]
  assertEquals(r[1], "Ed")
end

-- 65. `using` anonymous function alone

do
  local r = query [[
    from
      p = pages
    order by
      p.age using function(a, b) return a > b end
    select { name = p.name, age = p.age }
  ]]
  assertEquals(r[1].name, "Greg")  -- age 63
  assertEquals(r[#r].name, "Ed")   -- age 19
end

-- 66. `using` with nulls on different keys

do
  local data = {
    { name = "a", x = 1, y = 10 },
    { name = "b", x = 1 },
    { name = "c", x = 2, y = 5 },
    { name = "d", x = 2 },
  }
  local r = query [[
    from
      p = data
    order by
      p.x using function(a, b) return a < b end,
      p.y using function(a, b) return a < b end nulls first
    select { name = p.name }
  ]]
  assertEquals(r[1].name, "b")
  assertEquals(r[2].name, "a")
  assertEquals(r[3].name, "d")
  assertEquals(r[4].name, "c")
end

-- 67. Intra-aggregate order by: array_agg asc

do
  local data = {
    { grp = "a", name = "cherry", val = 3 },
    { grp = "a", name = "apple",  val = 1 },
    { grp = "a", name = "banana", val = 2 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(p.name order by p.val asc),
    }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].names[1], "apple")
  assertEquals(r[1].names[2], "banana")
  assertEquals(r[1].names[3], "cherry")
end

-- 68. Intra-aggregate order by: array_agg desc

do
  local data = {
    { grp = "a", name = "cherry", val = 3 },
    { grp = "a", name = "apple",  val = 1 },
    { grp = "a", name = "banana", val = 2 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(p.name order by p.val desc),
    }
  ]]
  assertEquals(r[1].names[1], "cherry")
  assertEquals(r[1].names[2], "banana")
  assertEquals(r[1].names[3], "apple")
end

-- 69. Intra-aggregate order by: same aggregate, asc vs desc in one select

do
  local data = {
    { grp = "x", name = "c", val = 3 },
    { grp = "x", name = "a", val = 1 },
    { grp = "x", name = "b", val = 2 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      asc_names = array_agg(p.name order by p.val asc),
      desc_names = array_agg(p.name order by p.val desc),
    }
  ]]
  assertEquals(r[1].asc_names[1], "a")
  assertEquals(r[1].asc_names[3], "c")
  assertEquals(r[1].desc_names[1], "c")
  assertEquals(r[1].desc_names[3], "a")
end

-- 70. Intra-aggregate order by: unbound access

do
  local data = {
    { grp = "x", name = "c", val = 3 },
    { grp = "x", name = "a", val = 1 },
    { grp = "x", name = "b", val = 2 },
  }
  local r = query [[
    from
      data
    group by
      grp
    select {
      names = array_agg(name order by val asc),
    }
  ]]
  assertEquals(r[1].names[1], "a")
  assertEquals(r[1].names[2], "b")
  assertEquals(r[1].names[3], "c")
end

-- 71. Intra-aggregate order by: order by the aggregated expression itself

do
  local data = {
    { grp = "x", name = "cherry" },
    { grp = "x", name = "apple"  },
    { grp = "x", name = "banana" },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(p.name order by p.name asc),
    }
  ]]
  assertEquals(r[1].names[1], "apple")
  assertEquals(r[1].names[2], "banana")
  assertEquals(r[1].names[3], "cherry")
end

-- 72. Intra-aggregate order by: multiple sort keys

do
  local data = {
    { grp = "x", name = "a2", cat = 1, pri = 2 },
    { grp = "x", name = "b1", cat = 2, pri = 1 },
    { grp = "x", name = "a1", cat = 1, pri = 1 },
    { grp = "x", name = "b2", cat = 2, pri = 2 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(p.name order by p.cat asc, p.pri desc),
    }
  ]]
  assertEquals(r[1].names[1], "a2")
  assertEquals(r[1].names[2], "a1")
  assertEquals(r[1].names[3], "b2")
  assertEquals(r[1].names[4], "b1")
end

-- 73. Intra-aggregate order by: with nulls in sort key

do
  local data = {
    { grp = "x", name = "b", val = 2 },
    { grp = "x", name = "n" },
    { grp = "x", name = "a", val = 1 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(p.name order by p.val asc),
    }
  ]]
  assertEquals(r[1].names[1], "a")
  assertEquals(r[1].names[2], "b")
  assertEquals(r[1].names[3], "n")
end

-- 74. Intra-aggregate order by: nulls first

do
  local data = {
    { grp = "x", name = "b", val = 2 },
    { grp = "x", name = "n" },
    { grp = "x", name = "a", val = 1 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(p.name order by p.val asc nulls first),
    }
  ]]
  assertEquals(r[1].names[1], "n")
  assertEquals(r[1].names[2], "a")
  assertEquals(r[1].names[3], "b")
end

-- 75. Intra-aggregate order by: nulls last explicit on desc

do
  local data = {
    { grp = "x", name = "b", val = 2 },
    { grp = "x", name = "n" },
    { grp = "x", name = "a", val = 1 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(p.name order by p.val desc nulls last),
    }
  ]]
  assertEquals(r[1].names[1], "b")
  assertEquals(r[1].names[2], "a")
  assertEquals(r[1].names[3], "n")
end

-- 76. Intra-aggregate order by: multiple groups

do
  local data = {
    { grp = "a", name = "z", val = 3 },
    { grp = "a", name = "x", val = 1 },
    { grp = "b", name = "m", val = 2 },
    { grp = "b", name = "k", val = 4 },
    { grp = "a", name = "y", val = 2 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      g = key,
      names = array_agg(p.name order by p.val asc),
    }
    order by
      g
  ]]
  assertEquals(#r, 2)

  assertEquals(r[1].names[1], "x")
  assertEquals(r[1].names[2], "y")
  assertEquals(r[1].names[3], "z")

  assertEquals(r[2].names[1], "m")
  assertEquals(r[2].names[2], "k")
end

-- 77. Intra-aggregate order by combined with filter

do
  local data = {
    { grp = "a", name = "d", val = 4, big = true },
    { grp = "a", name = "a", val = 1, big = false },
    { grp = "a", name = "c", val = 3, big = true },
    { grp = "a", name = "b", val = 2, big = false },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      all_sorted = array_agg(p.name order by p.val asc),
      big_sorted = array_agg(p.name order by p.val desc)
                       filter(where p.big),
      small_sorted = array_agg(p.name order by p.name asc)
                       filter(where not p.big),
    }
  ]]
  assertEquals(r[1].all_sorted[1], "a")
  assertEquals(r[1].all_sorted[4], "d")

  assertEquals(r[1].big_sorted[1], "d")
  assertEquals(r[1].big_sorted[2], "c")

  assertEquals(r[1].small_sorted[1], "a")
  assertEquals(r[1].small_sorted[2], "b")
end

-- 78. Intra-aggregate order by: sum is unaffected (order doesn't change sum)

do
  local data = {
    { grp = "a", val = 10 },
    { grp = "a", val = 30 },
    { grp = "a", val = 20 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      s1 = sum(p.val order by p.val asc),
      s2 = sum(p.val order by p.val desc),
      s3 = sum(p.val),
    }
  ]]
  assertEquals(r[1].s1, 60)
  assertEquals(r[1].s2, 60)
  assertEquals(r[1].s3, 60)
end

-- 79. Intra-aggregate order by: count is unaffected

do
  local data = {
    { grp = "a", name = "c", val = 3 },
    { grp = "a", name = "a", val = 1 },
    { grp = "a", name = "b", val = 2 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      c1 = count(p.name order by p.val asc),
      c2 = count(p.name order by p.val desc),
      c3 = count(p.name),
    }
  ]]
  assertEquals(r[1].c1, 3)
  assertEquals(r[1].c2, 3)
  assertEquals(r[1].c3, 3)
end

-- 80. Intra-aggregate order by on pages dataset

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
      names_asc = array_agg(p.name order by p.name asc),
      names_desc = array_agg(p.name order by p.name desc),
    }
    order by
      tag
  ]]
  assertEquals(r[1].tag, "personal")
  assertEquals(r[1].names_asc[1], "Carol")
  assertEquals(r[1].names_asc[2], "Dave")
  assertEquals(r[1].names_desc[1], "Dave")
  assertEquals(r[1].names_desc[2], "Carol")

  assertEquals(r[2].tag, "random")
  assertEquals(r[2].names_asc[1], "Fran")

  assertEquals(r[3].tag, "work")
  assertEquals(r[3].names_asc[1], "Alice")
  assertEquals(r[3].names_asc[2], "Bob")
  assertEquals(r[3].names_asc[3], "Greg")
  assertEquals(r[3].names_desc[1], "Greg")
  assertEquals(r[3].names_desc[2], "Bob")
  assertEquals(r[3].names_desc[3], "Alice")
end

-- 81. Intra-aggregate order by on pages dataset, order by size

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
      by_size_asc = array_agg(p.name order by p.size asc),
      by_size_desc = array_agg(p.name order by p.size desc),
    }
    order by
      tag
  ]]
  -- work: Greg(2), Alice(10), Bob(20)
  assertEquals(r[3].tag, "work")
  assertEquals(r[3].by_size_asc[1], "Greg")
  assertEquals(r[3].by_size_asc[2], "Alice")
  assertEquals(r[3].by_size_asc[3], "Bob")
  assertEquals(r[3].by_size_desc[1], "Bob")
  assertEquals(r[3].by_size_desc[2], "Alice")
  assertEquals(r[3].by_size_desc[3], "Greg")
end

-- 82. Intra-aggregate order by + filter on pages dataset

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
      big_by_age = array_agg(p.name order by p.age desc) filter(where p.size>2),
    }
    order by
      tag
  ]]
  assertEquals(r[1].tag, "personal")
  assertEquals(r[1].big_by_age[1], "Dave")
  assertEquals(r[1].big_by_age[2], "Carol")

  assertEquals(r[2].tag, "random")
  assertEquals(#r[2].big_by_age, 0)

  assertEquals(r[3].tag, "work")
  assertEquals(#r[3].big_by_age, 2)
  assertEquals(r[3].big_by_age[1], "Alice") -- age 31 > 25
  assertEquals(r[3].big_by_age[2], "Bob")
end

-- 83. Intra-aggregate order by with group by "all"

do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      youngest_first = array_agg(p.name order by p.age asc),
      oldest_first = array_agg(p.name order by p.age desc),
    }
  ]]
  assertEquals(#r, 1)

  assertEquals(r[1].youngest_first[1], "Ed")
  assertEquals(r[1].youngest_first[7], "Greg")
  assertEquals(r[1].oldest_first[1], "Greg")
  assertEquals(r[1].oldest_first[7], "Ed")
end

-- 84. Intra-aggregate order by: empty group produces empty array

do
  local data = {
    { grp = "a", name = "x", val = 1 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      filtered = array_agg(p.name order by p.val asc) filter(where p.val>100),
    }
  ]]
  assertEquals(#r[1].filtered, 0)
end

-- 85. Full pipeline

do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    having
      count() > 1
    select {
      tag = key,
      total = count(),
      sorted_names = array_agg(p.name order by p.age desc),
      young_names = array_agg(p.name order by p.name asc)
        filter(where p.age < 40),
      oldest = max(p.age),
    }
    order by
      total desc, tag
    limit
      2
  ]]
  assertEquals(#r, 2)

  assertEquals(r[1].tag, "work")
  assertEquals(r[1].total, 3)

  assertEquals(r[1].sorted_names[1], "Greg")
  assertEquals(r[1].sorted_names[2], "Alice")
  assertEquals(r[1].sorted_names[3], "Bob")

  assertEquals(r[1].young_names[1], "Alice")
  assertEquals(r[1].young_names[2], "Bob")
  assertEquals(r[1].oldest, 63)

  assertEquals(r[2].tag, "personal")
  assertEquals(r[2].total, 2)

  assertEquals(r[2].sorted_names[1], "Dave")
  assertEquals(r[2].sorted_names[2], "Carol")

  assertEquals(#r[2].young_names, 0)
  assertEquals(r[2].oldest, 52)
end

-- 86. Full pipeline with composite group by + intra-aggregate order by

do
  local data = {
    { dept = "eng",   level = "sr", name = "Alice", salary = 100 },
    { dept = "eng",   level = "sr", name = "Bob",   salary = 120 },
    { dept = "eng",   level = "jr", name = "Carol", salary = 60  },
    { dept = "sales", level = "sr", name = "Dave",  salary = 90  },
    { dept = "sales", level = "jr", name = "Eve",   salary = 50  },
    { dept = "sales", level = "jr", name = "Fran",  salary = 55  },
  }
  local r = query [[
    from
      p = data
    group by
      p.dept, p.level
    having
      count() > 1
    select {
      dept = key[1],
      level = key[2],
      n = count(),
      names_by_salary = array_agg(p.name order by p.salary desc),
      total_salary = sum(p.salary),
      top_earner = max(p.salary),
    }
    order by
      dept, level
  ]]
  assertEquals(#r, 2)

  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].level, "sr")
  assertEquals(r[1].n, 2)
  assertEquals(r[1].names_by_salary[1], "Bob")   -- 120
  assertEquals(r[1].names_by_salary[2], "Alice") -- 100
  assertEquals(r[1].total_salary, 220)
  assertEquals(r[1].top_earner, 120)

  assertEquals(r[2].dept, "sales")
  assertEquals(r[2].level, "jr")
  assertEquals(r[2].n, 2)
  assertEquals(r[2].names_by_salary[1], "Fran") -- 55
  assertEquals(r[2].names_by_salary[2], "Eve")  -- 50
  assertEquals(r[2].total_salary, 105)
  assertEquals(r[2].top_earner, 55)
end

-- 87. Intra-aggregate order by with unbound access, full pipeline

do
  local r = query [[
    from
      pages
    where
      tags[1] ~= nil
    group by
      tags[1]
    having
      count() >= 2
    select {
      tag = key,
      by_age = array_agg(name order by age asc),
      by_size = array_agg(name order by size desc),
    }
    order by
      tag
    limit
      2
  ]]
  assertEquals(#r, 2)

  assertEquals(r[1].tag, "personal")
  assertEquals(r[1].by_age[1], "Carol")
  assertEquals(r[1].by_age[2], "Dave")

  assertEquals(r[1].by_size[1], "Dave")
  assertEquals(r[1].by_size[2], "Carol")

  assertEquals(r[2].tag, "work")
  assertEquals(r[2].by_age[1], "Bob")
  assertEquals(r[2].by_age[2], "Alice")
  assertEquals(r[2].by_age[3], "Greg")

  assertEquals(r[2].by_size[1], "Bob")
  assertEquals(r[2].by_size[2], "Alice")
  assertEquals(r[2].by_size[3], "Greg")
end

-- 88. Intra-aggregate order by does not affect min/max/avg results

do
  local data = {
    { grp = "a", val = 30 },
    { grp = "a", val = 10 },
    { grp = "a", val = 20 },
  }
  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      mn1 = min(p.val order by p.val asc),
      mn2 = min(p.val order by p.val desc),
      mx1 = max(p.val order by p.val asc),
      mx2 = max(p.val order by p.val desc),
      av1 = avg(p.val order by p.val asc),
      av2 = avg(p.val order by p.val desc),
    }
  ]]
  assertEquals(r[1].mn1, 10)
  assertEquals(r[1].mn2, 10)
  assertEquals(r[1].mx1, 30)
  assertEquals(r[1].mx2, 30)
  assertEquals(r[1].av1, 20)
  assertEquals(r[1].av2, 20)
end

-- 89. Intra-aggregate order by + filter + outer order by + offset

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
      names = array_agg(p.name order by p.size asc) filter(where p.size > 1),
    }
    order by
      tag
    limit
      2, 1
  ]]
  assertEquals(#r, 2)
  assertEquals(r[1].tag, "random")
  assertEquals(r[2].tag, "work")
  assertEquals(r[2].names[1], "Greg")
  assertEquals(r[2].names[2], "Alice")
  assertEquals(r[2].names[3], "Bob")
end

-- 90. Complex full pipeline

do
  local data = {
    { dept = "eng",   name = "Alice", salary = 100, active = true  },
    { dept = "eng",   name = "Bob",   salary = 150, active = true  },
    { dept = "eng",   name = "Carol", salary = 80,  active = false },
    { dept = "sales", name = "Dave",  salary = 90,  active = true  },
    { dept = "sales", name = "Eve",   salary = 70,  active = true  },
    { dept = "sales", name = "Fran",  salary = 60,  active = false },
    { dept = "hr",    name = "Greg",  salary = 50,  active = true  },
  }

  local function salaryDesc(a, b)
    return a > b
  end

  local r = query [[
    from
      p = data
    where
      p.active
    group by
      p.dept
    having
      count() >= 2
    select {
      dept = key,
      headcount = count(),
      total_salary = sum(p.salary),
      avg_salary = avg(p.salary),
      top_salary = max(p.salary),
      names_by_sal = array_agg(p.name order by p.salary desc),
      cheap_names = array_agg(p.name order by p.name asc)
        filter(where p.salary < 100),
    }
    order by
      total_salary using salaryDesc
    limit
      2
  ]]

  assertEquals(#r, 2)

  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].headcount, 2)
  assertEquals(r[1].total_salary, 250)
  assertEquals(r[1].avg_salary, 125)
  assertEquals(r[1].top_salary, 150)
  assertEquals(r[1].names_by_sal[1], "Bob")   -- 150
  assertEquals(r[1].names_by_sal[2], "Alice") -- 100
  assertEquals(#r[1].cheap_names, 0)

  assertEquals(r[2].dept, "sales")
  assertEquals(r[2].headcount, 2)
  assertEquals(r[2].total_salary, 160)
  assertEquals(r[2].avg_salary, 80)
  assertEquals(r[2].top_salary, 90)
  assertEquals(r[2].names_by_sal[1], "Dave") -- 90
  assertEquals(r[2].names_by_sal[2], "Eve")  -- 70
  assertEquals(r[2].cheap_names[1], "Dave")
  assertEquals(r[2].cheap_names[2], "Eve")
end

-- 91. Attempt to use `order by` in non-aggregate function call errors

do
  local ok, err = pcall(function()
    local r = query [[
      from
        p = pages
      select
        tostring(p.name order by p.name)
    ]]
  end)
  assertEquals(ok, false)
  assertTrue(
    string.find(tostring(err), "'order by' is not allowed") ~= nil,
    "expected `order by` error, got: " .. tostring(err)
  )
end

-- 92. Standalone offset clause

-- 92a. Offset only, bound
do
  local r = query [[
    from
      p = pages
    select { name = p.name }
    order by
      p.name
    offset
      2
  ]]
  assertEquals(#r, 5)
  assertEquals(r[1].name, "Carol")
end

-- 92b. Offset only, unbound
do
  local r = query [[
    from
      pages
    order by
      name
    offset
      5
  ]]
  assertEquals(#r, 2)
  assertEquals(r[1].name, "Fran")
  assertEquals(r[2].name, "Greg")
end

-- 92c. Offset 0 returns everything
do
  local r = query [[
    from
      pages
    offset
      0
  ]]
  assertEquals(#r, #pages)
end

-- 92d. Offset larger than dataset returns empty
do
  local r = query [[
    from
      pages
    offset
      100
  ]]
  assertEquals(#r, 0)
end

-- 92e. Offset equal to dataset size returns empty
do
  local r = query [[
    from
      pages
    offset
      7
  ]]
  assertEquals(#r, 0)
end

-- 93. Standalone offset + limit (separate clauses)

-- 93a. Offset before limit
do
  local r = query [[
    from
      p = pages
    select { name = p.name }
    order by
      p.name
    offset
      2
    limit
      3
  ]]
  -- skip 2, take 3 -> Carol, Dave, Ed
  assertEquals(#r, 3)
  assertEquals(r[1].name, "Carol")
  assertEquals(r[2].name, "Dave")
  assertEquals(r[3].name, "Ed")
end

-- 93b. Limit before offset (order of clauses doesn't matter)
do
  local r = query [[
    from
      p = pages
    select { name = p.name }
    order by
      p.name
    limit
      3
    offset
      2
  ]]
  assertEquals(#r, 3)
  assertEquals(r[1].name, "Carol")
end

-- 93c. Offset beyond available rows with limit returns empty
do
  local r = query [[
    from
      pages
    limit
      3
    offset
      100
  ]]
  assertEquals(#r, 0)
end

-- 93d. Limit larger than remaining after offset
do
  local r = query [[
    from
      p = pages
    order by
      p.name
    offset
      5
    limit
      100
  ]]
  assertEquals(#r, 2)
end

-- 94. Standalone offset with where + order by

do
  local r = query [[
    from
      p = pages
    where
      p.size >= 5
    order by
      p.size
    select { name = p.name }
    offset
      1
  ]]
  assertEquals(#r, 3)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Dave")
  assertEquals(r[3].name, "Bob")
end

-- 95. Standalone offset with group by

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
    offset
      1
  ]]
  assertEquals(#r, 2)
  assertEquals(r[1].tag, "random")
  assertEquals(r[2].tag, "work")
end

-- 96. Standalone offset + limit with group by + having

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
      n = count(),
    }
    order by
      tag
    offset
      1
    limit
      1
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].tag, "random")
end

-- 97. Standalone offset wins over inline offset (last one wins)
do
  local r = query [[
    from
      p = pages
    order by
      p.name
    limit
      3, 1
    offset
      2
  ]]
  assertEquals(#r, 3)
  assertEquals(r[1].name, "Carol")
end