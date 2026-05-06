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

-- 8f. product
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      prod = product(p.size),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(type(row.prod) == "number" or row.prod == nil)
  end
end

-- 8g. string_agg
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      names = string_agg(p.name),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(type(row.names) == "string")
  end
end

-- 8h. string_agg with custom separator
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      names = string_agg(p.name, " | "),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(type(row.names) == "string")
  end
end

-- 8i. yaml_agg
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      y = yaml_agg(p.name),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(type(row.y) == "string")
  end
end

-- 8j. json_agg
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      j = json_agg(p.name),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(type(row.j) == "string")
  end
end

-- 8k. bool_and, bool_or
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      all_big = bool_and(p.size > 5),
      any_big = bool_or(p.size > 5),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(
      type(row.all_big) == "boolean" or row.all_big == nil,
      "bool_and must return boolean or nil"
    )
    assertTrue(
      type(row.any_big) == "boolean" or row.any_big == nil,
      "bool_or must return boolean or nil"
    )
  end
end

-- 8l. stddev_pop, var_pop
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    select {
      sd = stddev_pop(p.size),
      vr = var_pop(p.size),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(type(row.sd) == "number" or row.sd == nil)
    assertTrue(type(row.vr) == "number" or row.vr == nil)
  end
end

-- 8m. stddev_samp, var_samp (nil for single-element groups)
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
      sd = stddev_samp(p.size),
      vr = var_samp(p.size),
      n = count(p.name),
    }
  ]]
  for _, row in ipairs(r) do
    if row.n >= 2 then
      assertTrue(type(row.sd) == "number", "stddev_samp >= 2 items")
      assertTrue(type(row.vr) == "number", "var_samp >= 2 items")
    else
      -- single-element group -> nil
      assertEquals(row.sd, nil)
      assertEquals(row.vr, nil)
    end
  end
end

-- 8n. percentile_cont (needs order by ... asc inside aggregate)
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
      med = percentile_cont(p.size, 0.5 order by p.size asc),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(type(row.med) == "number" or row.med == nil)
  end
end

-- 8o. percentile_disc (needs order by ... asc inside aggregate)
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
      pd = percentile_disc(p.size, 0.5 order by p.size asc),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(type(row.pd) == "number" or row.pd == nil)
  end
end

-- 8p. quantile with explicit method (needs order by ... asc)
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
      q = quantile(p.size, 0.25, "lower" order by p.size asc),
    }
  ]]
  for _, row in ipairs(r) do
    assertTrue(type(row.q) == "number" or row.q == nil)
  end
end

-- 8q. percentile_cont on known data for exact value check
do
  local scores = {
    { g = "a", v = 10 },
    { g = "a", v = 20 },
    { g = "a", v = 30 },
    { g = "a", v = 40 },
  }
  local r = query [[
    from
      s = scores
    group by
      s.g
    select {
      med = percentile_cont(s.v, 0.5 order by s.v asc),
    }
  ]]
  -- [10,20,30,40] q=0.5 -> idx=1.5 -> 20 + 0.5*(30-20) = 25
  assertEquals(r[1].med, 25)
end

-- 8r. percentile_disc on known data for exact value check
do
  local scores = {
    { g = "a", v = 10 },
    { g = "a", v = 20 },
    { g = "a", v = 30 },
    { g = "a", v = 40 },
    { g = "a", v = 50 },
  }
  local r = query [[
    from
      s = scores
    group by
      s.g
    select {
      p25 = percentile_disc(s.v, 0.25 order by s.v asc),
    }
  ]]
  -- [10,20,30,40,50] q=0.25 -> idx=1.0 -> lower -> values[1] = 20
  assertEquals(r[1].p25, 20)
end

-- 8s. mode: most frequent tag in dataset
do
  local data = {
    { g = "a", v = "x" },
    { g = "a", v = "y" },
    { g = "a", v = "x" },
    { g = "a", v = "x" },
    { g = "a", v = "y" },
    { g = "b", v = "q" },
  }
  local r = query [[
    from
      d = data
    group by
      d.g
    select {
      k = key,
      m = mode(d.v),
    }
    order by
      k
  ]]
  -- group "a": x=3, y=2 -> mode = "x"
  assertEquals(r[1].m, "x")
  -- group "b": q=1 -> mode = "q"
  assertEquals(r[2].m, "q")
end

-- 8t. first / last with intra-aggregate order by
do
  local data = {
    { g = "a", v = "c", k = 3 },
    { g = "a", v = "a", k = 1 },
    { g = "a", v = "b", k = 2 },
  }
  local r = query [[
    from
      d = data
    group by
      d.g
    select {
      f = first(d.v order by d.k asc),
      l = last(d.v order by d.k asc),
    }
  ]]
  assertEquals(r[1].f, "a")
  assertEquals(r[1].l, "c")
end

-- 8u. first / last without order by (iteration order)
do
  local data = {
    { g = "x", v = 10 },
    { g = "x", v = 20 },
    { g = "x", v = 30 },
  }
  local r = query [[
    from
      d = data
    group by
      d.g
    select {
      f = first(d.v),
      l = last(d.v),
    }
  ]]
  assertEquals(r[1].f, 10)
  assertEquals(r[1].l, 30)
end

-- 8v. median on known data (odd)
do
  local data = {
    { g = "a", v = 30 },
    { g = "a", v = 10 },
    { g = "a", v = 20 },
  }
  local r = query [[
    from
      d = data
    group by
      d.g
    select {
      med = median(d.v order by d.v asc),
    }
  ]]
  assertEquals(r[1].med, 20)
end

-- 8w. median on known data (even, interpolated)
do
  local data = {
    { g = "a", v = 10 },
    { g = "a", v = 20 },
    { g = "a", v = 30 },
    { g = "a", v = 40 },
  }
  local r = query [[
    from
      d = data
    group by
      d.g
    select {
      med = median(d.v order by d.v asc),
    }
  ]]
  -- [10,20,30,40] -> 25
  assertEquals(r[1].med, 25)
end

-- 8x. first / last with filter
do
  local data = {
    { g = "a", v = 1,  big = false },
    { g = "a", v = 10, big = true  },
    { g = "a", v = 2,  big = false },
    { g = "a", v = 20, big = true  },
  }
  local r = query [[
    from
      d = data
    group by
      d.g
    select {
      fb = first(d.v order by d.v asc) filter(where d.big),
      lb = last(d.v order by d.v asc) filter(where d.big),
    }
  ]]
  assertEquals(r[1].fb, 10)
  assertEquals(r[1].lb, 20)
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
      -- Fran(1) total=1, big: nil (none pass)
      assertEquals(row.total_size, 1)
      assertEquals(row.big_size, nil)
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
  assertEquals(r[1].s, nil)
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
    string.find(tostring(err), "'order by' specified, but") ~= nil,
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

-- 98. Multi-source from (cross join) — basic

-- 98a. Two-source cross join, basic
do
  local colors = {
    { color = "red" },
    { color = "blue" },
  }
  local sizes = {
    { size = "S" },
    { size = "M" },
    { size = "L" },
  }
  local r = query [[
    from
      c = colors,
      s = sizes
    select {
      color = c.color,
      size = s.size,
    }
  ]]
  assertEquals(#r, 6, "98a: row count")
end

-- 98b. Two-source cross join with where
do
  local colors = {
    { color = "red" },
    { color = "blue" },
  }
  local sizes = {
    { size = "S" },
    { size = "M" },
    { size = "L" },
  }
  local r = query [[
    from
      c = colors,
      s = sizes
    where
      s.size ~= "L"
    select {
      color = c.color,
      size = s.size,
    }
  ]]
  assertEquals(#r, 4, "98b: row count")
end

-- 98c. Two-source cross join with order by
do
  local xs = {
    { x = 2 },
    { x = 1 },
  }
  local ys = {
    { y = "b" },
    { y = "a" },
  }
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      x = a.x,
      y = b.y,
    }
    order by
      a.x, b.y
  ]]
  assertEquals(#r, 4, "98c: row count")
  assertEquals(r[1].x, 1, "98c: r1.x")
  assertEquals(r[1].y, "a", "98c: r1.y")
  assertEquals(r[2].x, 1, "98c: r2.x")
  assertEquals(r[2].y, "b", "98c: r2.y")
  assertEquals(r[3].x, 2, "98c: r3.x")
  assertEquals(r[3].y, "a", "98c: r3.y")
  assertEquals(r[4].x, 2, "98c: r4.x")
  assertEquals(r[4].y, "b", "98c: r4.y")
end

-- 98d. Two-source cross join with limit
do
  local xs = { { v = 1 }, { v = 2 }, { v = 3 } }
  local ys = { { v = 10 }, { v = 20 } }
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      s = a.v + b.v,
    }
    limit
      3
  ]]
  assertEquals(#r, 3, "98d: row count")
end

-- 98e. Two-source cross join, select single expression
do
  local as = { { n = "x" }, { n = "y" } }
  local bs = { { n = "1" }, { n = "2" } }
  local r = query [[
    from
      a = as,
      b = bs
    select
      a.n .. b.n
  ]]
  assertEquals(#r, 4, "98e: row count")
end

-- 99. Three-source cross join

-- 99a. Three-source basic
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = "a" }, { y = "b" } }
  local zs = { { z = "p" }, { z = "q" } }
  local r = query [[
    from
      a = xs,
      b = ys,
      c = zs
    select {
      x = a.x,
      y = b.y,
      z = c.z,
    }
  ]]
  assertEquals(#r, 8, "99a: row count")
end

-- 99b. Three-source with where filter
do
  local xs = { { x = 1 }, { x = 2 }, { x = 3 } }
  local ys = { { y = 10 }, { y = 20 } }
  local zs = { { z = 100 } }
  local r = query [[
    from
      a = xs,
      b = ys,
      c = zs
    where
      a.x + b.y > 15
    select {
      total = a.x + b.y + c.z,
    }
  ]]
  -- 1+20=21 yes, 2+20=22 yes, 3+20=23 yes -> 3 combos
  -- totals: 121, 122, 123 all distinct
  assertEquals(#r, 3, "99b: row count")
end

-- 99c. Three-source with order by + limit
do
  local xs = { { v = 1 }, { v = 2 } }
  local ys = { { v = 30 }, { v = 40 } }
  local zs = { { v = 500 }, { v = 600 } }
  local r = query [[
    from
      a = xs,
      b = ys,
      c = zs
    select {
      s = a.v + b.v + c.v,
    }
    order by
      a.v + b.v + c.v
    limit
      3
  ]]
  assertEquals(#r, 3, "99c: row count")
  assertEquals(r[1].s, 531, "99c: first")   -- 1+30+500
  assertEquals(r[2].s, 532, "99c: second")  -- 2+30+500
  assertEquals(r[3].s, 541, "99c: third")   -- 1+40+500
end

-- 100. Four-source cross join

-- 100a. Four-source basic
do
  local a = { { v = 1 } }
  local b = { { v = 2 }, { v = 3 } }
  local c = { { v = 4 } }
  local d = { { v = 50 }, { v = 60 } }
  local r = query [[
    from
      w = a,
      x = b,
      y = c,
      z = d
    select {
      s = w.v + x.v + y.v + z.v,
    }
    order by
      w.v + x.v + y.v + z.v
  ]]
  -- 1*2*1*2 = 4 rows, sums: 57,67,58,68 all distinct
  assertEquals(#r, 4, "100a: row count")
  assertEquals(r[1].s, 57, "100a: first")   -- 1+2+4+50
  assertEquals(r[2].s, 58, "100a: second")  -- 1+3+4+50
  assertEquals(r[3].s, 67, "100a: third")   -- 1+2+4+60
  assertEquals(r[4].s, 68, "100a: fourth")  -- 1+3+4+60
end

-- 101. Join hints: hash, loop, merge

-- 101a. Two-source with `hash` hint
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = 10 }, { y = 20 } }
  local r = query [[
    from
      a = xs,
      hash b = ys
    select {
      x = a.x,
      y = b.y,
    }
  ]]
  assertEquals(#r, 4, "101a: row count")
end

-- 101b. Two-source with `loop` hint
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = 10 }, { y = 20 } }
  local r = query [[
    from
      a = xs,
      loop b = ys
    select {
      x = a.x,
      y = b.y,
    }
  ]]
  assertEquals(#r, 4, "101b: row count")
end

-- 101c. Three-source with mixed hints
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = "a" } }
  local zs = { { z = "p" }, { z = "q" } }
  local r = query [[
    from
      a = xs,
      hash b = ys,
      loop c = zs
    select {
      x = a.x,
      y = b.y,
      z = c.z,
    }
  ]]
  assertEquals(#r, 4, "101d: row count")
end

-- 101d. Hint on first source in multi-source
do
  local xs = { { x = 1 } }
  local ys = { { y = 2 } }
  local r = query [[
    from
      hash a = xs,
      b = ys
    select {
      x = a.x,
      y = b.y,
    }
  ]]
  assertEquals(#r, 1, "101e: row count")
end

-- 101e. All three hint types produce same results
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = 10 }, { y = 20 } }
  local rh = query [[
    from a = xs, hash b = ys
    select { x = a.x, y = b.y }
    order by a.x, b.y
  ]]
  local rl = query [[
    from a = xs, loop b = ys
    select { x = a.x, y = b.y }
    order by a.x, b.y
  ]]
  local rm = query [[
    from a = xs, b = ys
    select { x = a.x, y = b.y }
    order by a.x, b.y
  ]]
  assertEquals(#rh, #rl, "101f: hash vs loop count")
  assertEquals(#rh, #rm, "101f: hash vs merge count")
  for i = 1, #rh do
    assertEquals(rh[i].x, rl[i].x, "101f: hash vs loop x at " .. i)
    assertEquals(rh[i].y, rl[i].y, "101f: hash vs loop y at " .. i)
    assertEquals(rh[i].x, rm[i].x, "101f: hash vs merge x at " .. i)
    assertEquals(rh[i].y, rm[i].y, "101f: hash vs merge y at " .. i)
  end
end

-- 102. leading

-- 102a. Two-source with leading
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = 10 }, { y = 20 } }
  local r = query [[
    from
      a = xs,
      b = ys
    leading b, a
    select {
      x = a.x,
      y = b.y,
    }
  ]]
  assertEquals(#r, 4, "102a: row count")
end

-- 102b. Three-source with leading
do
  local xs = { { v = 1 } }
  local ys = { { v = 20 }, { v = 30 } }
  local zs = { { v = 400 } }
  local r = query [[
    from
      a = xs,
      b = ys,
      c = zs
    leading c, a, b
    select {
      s = a.v + b.v + c.v,
    }
    order by
      a.v + b.v + c.v
  ]]
  assertEquals(#r, 2, "102b: row count")
  assertEquals(r[1].s, 421, "102b: first")  -- 1+20+400
  assertEquals(r[2].s, 431, "102b: second") -- 1+30+400
end

-- 102c. leading with join hint
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = 10 }, { y = 20 } }
  local r = query [[
    from
      hash a = xs,
      loop b = ys
    leading b, a
    select {
      x = a.x,
      y = b.y,
    }
  ]]
  assertEquals(#r, 4, "102c: row count")
end

-- 102d. leading with where filter
do
  local xs = { { x = 1 }, { x = 2 }, { x = 3 } }
  local ys = { { y = 10 }, { y = 20 } }
  local r = query [[
    from
      a = xs,
      b = ys
    leading a, b
    where
      a.x > 1
    select {
      x = a.x,
      y = b.y,
    }
    order by
      a.x, b.y
  ]]
  assertEquals(#r, 4, "102d: row count")
  assertEquals(r[1].x, 2, "102d: r1.x")
  assertEquals(r[1].y, 10, "102d: r1.y")
end

-- 102e. leading partial (only some sources named)
do
  local xs = { { v = 1 }, { v = 2 } }
  local ys = { { v = 100 } }
  local zs = { { v = 1000 } }
  local r = query [[
    from
      a = xs,
      b = ys,
      c = zs
    leading c
    select {
      s = a.v + b.v + c.v,
    }
    order by
      a.v + b.v + c.v
  ]]
  assertEquals(#r, 2, "102e: row count")
  assertEquals(r[1].s, 1101, "102e: first")  -- 1+100+1000
  assertEquals(r[2].s, 1102, "102e: second") -- 2+100+1000
end

-- 103. Multi-source with group by and aggregates
do
  local depts = {
    { dept = "eng" },
    { dept = "sales" },
  }
  local employees = {
    { name = "Alice", dept = "eng" },
    { name = "Bob",   dept = "eng" },
    { name = "Carol", dept = "sales" },
  }
  local r = query [[
    from
      d = depts,
      e = employees
    where
      d.dept == e.dept
    select all {
      dept = d.dept,
      name = e.name,
    }
    order by
      dept, name
  ]]

  assertEquals(#r, 3)
  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].dept, "eng")
  assertEquals(r[2].name, "Bob")
  assertEquals(r[3].dept, "sales")
  assertEquals(r[3].name, "Carol")
end

-- 103a. Cross join + group by + count
do
  local depts = {
    { dept = "eng" },
    { dept = "sales" },
  }
  local employees = {
    { name = "Alice", dept = "eng" },
    { name = "Bob",   dept = "eng" },
    { name = "Carol", dept = "sales" },
  }
  local r = query [[
    from
      d = depts,
      e = employees
    where
      d.dept == e.dept
    group by
      d.dept
    select {
      dept = key,
      n = count(),
    }
    order by
      dept
  ]]

  assertEquals(#r, 2, "103a: row count")
  assertEquals(r[1].dept, "eng", "103a: r1.dept")
  assertTrue(type(r[1].n) == "number", "103a: r1.n type=" .. tostring(r[1].n))
  assertEquals(r[2].dept, "sales", "103a: r2.dept")
  assertTrue(type(r[2].n) == "number", "103a: r2.n type=" .. tostring(r[2].n))
end

-- 103b. Cross join + group by + sum + array_agg
do
  local categories = {
    { cat = "fruit" },
    { cat = "veg" },
  }
  local items = {
    { name = "apple",  cat = "fruit", price = 3 },
    { name = "banana", cat = "fruit", price = 2 },
    { name = "carrot", cat = "veg",   price = 1 },
    { name = "daikon", cat = "veg",   price = 4 },
  }
  local r = query [[
    from
      c = categories,
      i = items
    where
      c.cat == i.cat
    group by
      c.cat
    select {
      cat = key,
      total = sum(i.price),
      names = array_agg(i.name order by i.name asc),
    }
    order by
      cat
  ]]
  assertEquals(#r, 2, "103b: row count")
  assertEquals(r[1].cat, "fruit", "103b: r1.cat")
  assertEquals(r[1].total, 5, "103b: r1.total")
  assertEquals(r[1].names[1], "apple", "103b: r1.names[1]")
  assertEquals(r[1].names[2], "banana", "103b: r1.names[2]")
  assertEquals(r[2].cat, "veg", "103b: r2.cat")
  assertEquals(r[2].total, 5, "103b: r2.total")
  assertEquals(r[2].names[1], "carrot", "103b: r2.names[1]")
  assertEquals(r[2].names[2], "daikon", "103b: r2.names[2]")
end

-- 103c. Cross join + group by + having
do
  local depts = {
    { dept = "eng" },
    { dept = "sales" },
    { dept = "hr" },
  }
  local employees = {
    { name = "Alice", dept = "eng" },
    { name = "Bob",   dept = "eng" },
    { name = "Carol", dept = "sales" },
  }
  local r = query [[
    from
      d = depts,
      e = employees
    where
      d.dept == e.dept
    group by
      d.dept
    having
      count() >= 2
    select {
      dept = key,
      n = count(),
    }
  ]]
  assertEquals(#r, 1, "103c: row count")
  assertEquals(r[1].dept, "eng", "103c: dept")
  assertEquals(r[1].n, 2, "103c: n")
end

-- 103d. Cross join + group by + min/max/avg
do
  local groups = { { g = "A" }, { g = "B" } }
  local vals = {
    { g = "A", v = 10 },
    { g = "A", v = 20 },
    { g = "A", v = 30 },
    { g = "B", v = 5 },
    { g = "B", v = 15 },
  }
  local r = query [[
    from
      gr = groups,
      item = vals
    where
      gr.g == item.g
    group by
      gr.g
    select {
      g = key,
      lo = min(item.v),
      hi = max(item.v),
      av = avg(item.v),
    }
    order by
      g
  ]]
  assertEquals(#r, 2, "103d: row count")
  assertEquals(r[1].lo, 10, "103d: A lo")
  assertEquals(r[1].hi, 30, "103d: A hi")
  assertEquals(r[1].av, 20, "103d: A avg")
  assertEquals(r[2].lo, 5, "103d: B lo")
  assertEquals(r[2].hi, 15, "103d: B hi")
  assertEquals(r[2].av, 10, "103d: B avg")
end

-- 104. Edge cases for multi-source from

-- 104a. Empty first source
do
  local xs = {}
  local ys = { { y = 1 }, { y = 2 } }
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      y = b.y,
    }
  ]]
  assertEquals(#r, 0, "104a: row count")
end

-- 104b. Empty second source
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = {}
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      x = a.x,
    }
  ]]
  assertEquals(#r, 0, "104b: row count")
end

-- 104c. Singleton * singleton
do
  local xs = { { x = 42 } }
  local ys = { { y = 99 } }
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      x = a.x,
      y = b.y,
    }
  ]]
  assertEquals(#r, 1, "104c: row count")
  assertEquals(r[1].x, 42, "104c: x")
  assertEquals(r[1].y, 99, "104c: y")
end

-- 104d. Same source twice (self-join)
do
  local xs = { { v = 1 }, { v = 2 }, { v = 3 } }
  local r = query [[
    from
      a = xs,
      b = xs
    where
      a.v < b.v
    select {
      av = a.v,
      bv = b.v,
    }
    order by
      a.v, b.v
  ]]
  assertEquals(#r, 3, "104d: row count")
  assertEquals(r[1].av, 1, "104d: r1.av")
  assertEquals(r[1].bv, 2, "104d: r1.bv")
  assertEquals(r[2].av, 1, "104d: r2.av")
  assertEquals(r[2].bv, 3, "104d: r2.bv")
  assertEquals(r[3].av, 2, "104d: r3.av")
  assertEquals(r[3].bv, 3, "104d: r3.bv")
end

-- 104e. Self-join three-way (triangles)
do
  local nums = { { v = 1 }, { v = 2 }, { v = 3 }, { v = 4 } }
  local r = query [[
    from
      a = nums,
      b = nums,
      c = nums
    where
      a.v < b.v and b.v < c.v
    select {
      triple = a.v .. "-" .. b.v .. "-" .. c.v,
    }
    order by
      a.v, b.v, c.v
  ]]
  assertEquals(#r, 4, "104e: row count")
  assertEquals(r[1].triple, "1-2-3", "104e: first")
  assertEquals(r[2].triple, "1-2-4", "104e: second")
  assertEquals(r[3].triple, "1-3-4", "104e: third")
  assertEquals(r[4].triple, "2-3-4", "104e: fourth")
end

-- 104f. Cross join result used with offset
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = "a" }, { y = "b" }, { y = "c" } }
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      x = a.x,
      y = b.y,
    }
    order by
      a.x, b.y
    limit
      3, 2
  ]]
  assertEquals(#r, 3, "104f: row count")
end

-- 104g. Without an explicit select, multi-source FROM behaves like an
-- explicit `select *` -- columns from every source are merged at the top
-- level under qualified `<source>_<col>` keys (rather than under their
-- alias keys). (See 206 for the full spec; this test pins the cross-join
-- shape.)
do
  local xs = { { x = 1 } }
  local ys = { { y = 2 } }
  local r = query [[
    from
      a = xs,
      b = ys
  ]]
  assertEquals(#r, 1, "104g: row count")
  assertEquals(r[1].a_x, 1, "104g: a_x flattened from a")
  assertEquals(r[1].b_y, 2, "104g: b_y flattened from b")
  assertEquals(r[1].a, nil, "104g: nested 'a' key must not leak")
  assertEquals(r[1].b, nil, "104g: nested 'b' key must not leak")
end

-- 104h. Where that matches nothing
do
  local xs = { { v = 1 }, { v = 2 } }
  local ys = { { v = 3 }, { v = 4 } }
  local r = query [[
    from
      a = xs,
      b = ys
    where
      a.v > 100
    select {
      av = a.v,
    }
  ]]
  assertEquals(#r, 0, "104h: row count")
end

-- 104i. Outer variable accessible in where
do
  local threshold = 15
  local xs = { { v = 10 }, { v = 20 } }
  local ys = { { v = 1 }, { v = 2 } }
  local r = query [[
    from
      a = xs,
      b = ys
    where
      a.v + b.v > threshold
    select {
      s = a.v + b.v,
    }
    order by
      a.v + b.v
  ]]
  assertEquals(#r, 2, "104i: row count")
  assertEquals(r[1].s, 21, "104i: first")
  assertEquals(r[2].s, 22, "104i: second")
end

-- 104j. Nested field access
do
  local xs = { { info = { label = "x1" } }, { info = { label = "x2" } } }
  local ys = { { info = { label = "y1" } } }
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      pair = a.info.label .. "-" .. b.info.label,
    }
    order by
      a.info.label
  ]]
  assertEquals(#r, 2, "104j: row count")
  assertEquals(r[1].pair, "x1-y1", "104j: first")
  assertEquals(r[2].pair, "x2-y1", "104j: second")
end

-- 105. Multi-source with existing pages dataset

-- 105a. Pages self-join (find pairs sharing same first tag)
do
  local r = query [[
    from
      p1 = pages,
      p2 = pages
    where
      p1.name < p2.name and p1.tags[1] == p2.tags[1]
    select {
      a = p1.name,
      b = p2.name,
      tag = p1.tags[1],
    }
    order by
      p1.name, p2.name
  ]]
  assertEquals(#r, 4, "105a: row count")
  assertEquals(r[1].a, "Alice", "105a: first pair a")
  assertEquals(r[1].b, "Bob", "105a: first pair b")
end

-- 105b. Pages cross with small dataset, group by
do
  local thresholds = {
    { label = "small", max_size = 5 },
    { label = "big", max_size = 100 },
  }
  local r = query [[
    from
      p = pages,
      t = thresholds
    where
      p.size <= t.max_size
    group by
      t.label
    select {
      label = key,
      n = count(),
    }
    order by
      label
  ]]
  assertEquals(#r, 2, "105b: row count")
  assertEquals(r[1].label, "big", "105b: r1.label")
  assertEquals(r[1].n, 7, "105b: r1.n")
  assertEquals(r[2].label, "small", "105b: r2.label")
  assertEquals(r[2].n, 4, "105b: r2.n")
end

-- 106. leading + full pipeline

-- 106a. leading + where + select + order by + limit
do
  local xs = { { x = 1 }, { x = 2 }, { x = 3 } }
  local ys = { { y = 100 }, { y = 200 }, { y = 300 } }
  local r = query [[
    from
      a = xs,
      b = ys
    leading b, a
    where
      a.x + b.y <= 202
    select {
      s = a.x + b.y,
    }
    order by
      a.x + b.y desc
    limit
      4
  ]]
  assertEquals(#r, 4, "106a: row count")
  assertEquals(r[1].s, 202, "106a: first")
  assertEquals(r[2].s, 201, "106a: second")
  assertEquals(r[3].s, 103, "106a: third")
  assertEquals(r[4].s, 102, "106a: fourth")
end

-- 107. Multi-source with order by using comparator

-- 107a. Custom comparator on cross join result
do
  local xs = { { v = 1 }, { v = 2 } }
  local ys = { { v = 100 }, { v = 200 } }
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      s = a.v + b.v,
    }
    order by
      a.v + b.v using function(a, b) return a > b end
  ]]
  assertEquals(r[1].s, 202, "107a: first")
  assertEquals(r[#r].s, 101, "107a: last")
end

-- 107b. Order by field from each source
do
  local xs = { { v = 2 }, { v = 1 } }
  local ys = { { v = 20 }, { v = 10 } }
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      av = a.v,
      bv = b.v,
    }
    order by
      a.v, b.v
  ]]
  assertEquals(#r, 4, "107b: row count")
  assertEquals(r[1].av, 1, "107b: r1.av")
  assertEquals(r[1].bv, 10, "107b: r1.bv")
  assertEquals(r[2].av, 1, "107b: r2.av")
  assertEquals(r[2].bv, 20, "107b: r2.bv")
  assertEquals(r[3].av, 2, "107b: r3.av")
  assertEquals(r[3].bv, 10, "107b: r3.bv")
  assertEquals(r[4].av, 2, "107b: r4.av")
  assertEquals(r[4].bv, 20, "107b: r4.bv")
end

-- 108. Four-source with full pipeline

do
  local colors   = { { c = "red" }, { c = "blue" } }
  local sizes    = { { s = "S" }, { s = "M" }, { s = "L" } }
  local prices   = { { p = 10 }, { p = 20 } }
  local discounts = { { d = 0 }, { d = 5 } }
  local r = query [[
    from
      co = colors,
      si = sizes,
      pr = prices,
      di = discounts
    where
      pr.p - di.d > 5
    group by
      co.c
    having
      count() >= 3
    select {
      color = key,
      combos = count(),
      max_net = max(pr.p - di.d),
    }
    order by
      color
  ]]
  assertEquals(#r, 2, "108: row count")
  assertEquals(r[1].color, "blue", "108: r1.color")
  assertEquals(r[2].color, "red", "108: r2.color")
  assertEquals(r[1].combos, 9, "108: r1.combos")
  assertEquals(r[1].max_net, 20, "108: r1.max_net")
end

-- 109. Negative / error tests

-- 109a. Nil source in cross join
do
  local ok, err = pcall(function()
    local xs = { { v = 1 } }
    local r = query [[
      from
        a = xs,
        b = nonexistent
      select {
        av = a.v,
      }
    ]]
  end)
  assertTrue(not ok, "109a: expected error for nil source in cross join")
end

-- 109b. Multi-source without named bindings should error
do
  local ok, err = pcall(function()
    local xs = { { x = 1 } }
    local ys = { { y = 2 } }
    local r = query [[
      from
        a = xs,
        ys
    ]]
  end)
  assertTrue(not ok, "109b: expected error for unnamed source in multi-source from")
end

-- 110. Duplicate rows in cross join (distinct deduplication by default)

-- 110a. Duplicate select results are deduped (default distinct=true)
do
  local xs = { { v = 1 }, { v = 1 } }
  local ys = { { v = 2 } }
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      av = a.v,
      bv = b.v,
    }
  ]]
  assertEquals(#r, 1, "110a: deduped to 1")
  assertEquals(r[1].av, 1, "110a: av")
end

-- 110b. Non-duplicate rows are all kept
do
  local xs = { { v = 1 }, { v = 2 } }
  local ys = { { v = 10 }, { v = 20 } }
  local r = query [[
    from
      a = xs,
      b = ys
    select {
      av = a.v,
      bv = b.v,
    }
  ]]
  assertEquals(#r, 4, "110b: all distinct kept")
end

-- 110c. Without select, raw rows with same content are deduped
do
  local xs = { { v = 1 }, { v = 1 } }
  local ys = { { v = 2 } }
  local r = query [[
    from
      a = xs,
      b = ys
  ]]
  assertEquals(#r, 1, "110c: deduped raw rows")
end

-- 111. loop using join predicate

-- 111a. loop using with inline function
do
  local xs = {
    { id = 1, name = "Alice" },
    { id = 2, name = "Bob" },
    { id = 3, name = "Carol" },
  }
  local ys = {
    { fk = 2, val = "X" },
    { fk = 1, val = "Y" },
    { fk = 3, val = "Z" },
    { fk = 1, val = "W" },
  }

  local joined = query [[
    from
      a = xs,
      loop using function(a, b)
        return a.id == b.fk
      end b = ys
    select {
      a_name = a.name,
      b_val  = b.val,
    }
    order by
      a.name, b.val
  ]]

  assertEquals(#joined, 4, "111a: row count")
  assertEquals(joined[1].a_name, "Alice")
  assertEquals(joined[1].b_val, "W")
  assertEquals(joined[2].a_name, "Alice")
  assertEquals(joined[2].b_val, "Y")
  assertEquals(joined[3].a_name, "Bob")
  assertEquals(joined[3].b_val, "X")
  assertEquals(joined[4].a_name, "Carol")
  assertEquals(joined[4].b_val, "Z")
end

-- 111b. loop using with named function
do
  local xs = {
    { id = 1, name = "Alice" },
    { id = 2, name = "Bob" },
  }
  local ys = {
    { fk = 2, val = "X" },
    { fk = 1, val = "Y" },
    { fk = 2, val = "Z" },
  }

  local function matchById(a, b)
    return a.id == b.fk
  end

  local joined = query [[
    from
      a = xs,
      loop using matchById b = ys
    select {
      a_name = a.name,
      b_val  = b.val,
    }
    order by
      a.name, b.val
  ]]

  assertEquals(#joined, 3, "111b: row count")
  assertEquals(joined[1].a_name, "Alice")
  assertEquals(joined[1].b_val, "Y")
  assertEquals(joined[2].a_name, "Bob")
  assertEquals(joined[2].b_val, "X")
  assertEquals(joined[3].a_name, "Bob")
  assertEquals(joined[3].b_val, "Z")
end

-- 111c. loop using with no matches returns empty
do
  local xs = {
    { id = 1 },
    { id = 2 },
  }
  local ys = {
    { fk = 99 },
    { fk = 100 },
  }

  local joined = query [[
    from
      a = xs,
      loop using function(a, b)
        return a.id == b.fk
      end b = ys
    select {
      x = a.id,
      y = b.fk,
    }
  ]]

  assertEquals(#joined, 0, "111c: row count")
end

-- 111d. loop using with all matches (same as cross join)
do
  local xs = {
    { v = 1 },
    { v = 2 },
  }
  local ys = {
    { v = 10 },
    { v = 20 },
  }

  local joined = query [[
    from
      a = xs,
      loop using function(a, b)
        return true
      end b = ys
    select {
      s = a.v + b.v,
    }
    order by
      a.v + b.v
  ]]

  assertEquals(#joined, 4, "111d: row count")
  assertEquals(joined[1].s, 11, "111d: first")
  assertEquals(joined[2].s, 12, "111d: second")
  assertEquals(joined[3].s, 21, "111d: third")
  assertEquals(joined[4].s, 22, "111d: fourth")
end

-- 111e. loop using with where clause (post-join filter)
do
  local xs = {
    { id = 1, name = "Alice" },
    { id = 2, name = "Bob" },
    { id = 3, name = "Carol" },
  }
  local ys = {
    { fk = 1, val = "Y" },
    { fk = 2, val = "X" },
    { fk = 1, val = "W" },
    { fk = 3, val = "Z" },
  }

  local joined = query [[
    from
      a = xs,
      loop using function(a, b)
        return a.id == b.fk
      end b = ys
    where
      a.name ~= "Bob"
    select {
      a_name = a.name,
      b_val  = b.val,
    }
    order by
      a.name, b.val
  ]]

  assertEquals(#joined, 3, "111e: row count")
  assertEquals(joined[1].a_name, "Alice")
  assertEquals(joined[1].b_val, "W")
  assertEquals(joined[2].a_name, "Alice")
  assertEquals(joined[2].b_val, "Y")
  assertEquals(joined[3].a_name, "Carol")
  assertEquals(joined[3].b_val, "Z")
end

-- 111f. loop using with group by and aggregates
do
  local depts = {
    { dept = "eng" },
    { dept = "sales" },
    { dept = "hr" },
  }
  local employees = {
    { name = "Alice", dept = "eng",   sal = 100 },
    { name = "Bob",   dept = "eng",   sal = 120 },
    { name = "Carol", dept = "sales", sal = 90 },
    { name = "Dave",  dept = "sales", sal = 80 },
    { name = "Eve",   dept = "hr",    sal = 70 },
  }

  local joined = query [[
    from
      d = depts,
      loop using function(d, e)
        return d.dept == e.dept
      end e = employees
    group by
      d.dept
    select {
      dept  = key,
      n     = count(),
      total = sum(e.sal),
    }
    order by
      dept
  ]]

  assertEquals(#joined, 3, "111f: row count")
  assertEquals(joined[1].dept, "eng")
  assertEquals(joined[1].n, 2)
  assertEquals(joined[1].total, 220)
  assertEquals(joined[2].dept, "hr")
  assertEquals(joined[2].n, 1)
  assertEquals(joined[2].total, 70)
  assertEquals(joined[3].dept, "sales")
  assertEquals(joined[3].n, 2)
  assertEquals(joined[3].total, 170)
end

-- 111g. loop using with limit and offset
do
  local xs = {
    { id = 1, name = "A" },
    { id = 2, name = "B" },
    { id = 3, name = "C" },
  }
  local ys = {
    { fk = 1, val = "p" },
    { fk = 2, val = "q" },
    { fk = 3, val = "r" },
    { fk = 1, val = "s" },
  }

  local joined = query [[
    from
      a = xs,
      loop using function(a, b)
        return a.id == b.fk
      end b = ys
    select {
      a_name = a.name,
      b_val  = b.val,
    }
    order by
      a.name, b.val
    limit
      2, 1
  ]]

  -- Full sorted result: A/p, A/s, B/q, C/r -> skip 1, take 2
  assertEquals(#joined, 2, "111g: row count")
  assertEquals(joined[1].a_name, "A")
  assertEquals(joined[1].b_val, "s")
  assertEquals(joined[2].a_name, "B")
  assertEquals(joined[2].b_val, "q")
end

-- 111h. loop using with inequality predicate
do
  local xs = {
    { v = 1 },
    { v = 2 },
    { v = 3 },
  }
  local ys = {
    { v = 2 },
    { v = 3 },
    { v = 4 },
  }

  local joined = query [[
    from
      a = xs,
      loop using function(a, b)
        return a.v < b.v
      end b = ys
    select {
      av = a.v,
      bv = b.v,
    }
    order by
      a.v, b.v
  ]]

  -- 1<2,1<3,1<4, 2<3,2<4, 3<4 -> 6 pairs
  assertEquals(#joined, 6, "111h: row count")
  assertEquals(joined[1].av, 1)
  assertEquals(joined[1].bv, 2)
  assertEquals(joined[6].av, 3)
  assertEquals(joined[6].bv, 4)
end

-- 111i. loop using on empty source
do
  local xs = {}
  local ys = {
    { fk = 1, val = "Y" },
  }

  local joined = query [[
    from
      a = xs,
      loop using function(a, b)
        return true
      end b = ys
    select {
      bv = b.val,
    }
  ]]

  assertEquals(#joined, 0, "111i: row count")
end

-- 111j. loop using produces same results as plain loop + where
do
  local xs = {
    { id = 1, name = "A" },
    { id = 2, name = "B" },
  }
  local ys = {
    { fk = 1, val = "p" },
    { fk = 2, val = "q" },
    { fk = 1, val = "r" },
  }

  local r_using = query [[
    from
      a = xs,
      loop using function(a, b)
        return a.id == b.fk
      end b = ys
    select {
      n = a.name,
      v = b.val,
    }
    order by
      a.name, b.val
  ]]

  local r_where = query [[
    from
      a = xs,
      loop b = ys
    where
      a.id == b.fk
    select {
      n = a.name,
      v = b.val,
    }
    order by
      a.name, b.val
  ]]

  assertEquals(#r_using, #r_where, "111j: same count")
  for i = 1, #r_using do
    assertEquals(r_using[i].n, r_where[i].n, "111j: name at " .. i)
    assertEquals(r_using[i].v, r_where[i].v, "111j: val at " .. i)
  end
end

-- 112. select distinct / select all

-- 112a. select distinct removes duplicate rows (explicit)
do
  local data = {
    { cat = "a", val = 1 },
    { cat = "a", val = 1 },
    { cat = "b", val = 2 },
    { cat = "a", val = 1 },
  }

  local r = query [[
    from
      p = data
    select distinct {
      cat = p.cat,
      val = p.val,
    }
    order by
      p.cat, p.val
  ]]

  assertEquals(#r, 2, "112a: row count")
  assertEquals(r[1].cat, "a")
  assertEquals(r[1].val, 1)
  assertEquals(r[2].cat, "b")
  assertEquals(r[2].val, 2)
end

-- 112b. select all keeps duplicate rows
do
  local data = {
    { cat = "a", val = 1 },
    { cat = "a", val = 1 },
    { cat = "b", val = 2 },
    { cat = "a", val = 1 },
  }

  local r = query [[
    from
      p = data
    select all {
      cat = p.cat,
      val = p.val,
    }
    order by
      p.cat, p.val
  ]]

  assertEquals(#r, 4, "112b: row count")
  assertEquals(r[1].cat, "a")
  assertEquals(r[2].cat, "a")
  assertEquals(r[3].cat, "a")
  assertEquals(r[4].cat, "b")
end

-- 112c. default select (no qualifier) deduplicates
do
  local data = {
    { v = 10 },
    { v = 10 },
    { v = 20 },
  }

  local r = query [[
    from
      p = data
    select {
      v = p.v,
    }
  ]]

  assertEquals(#r, 2, "112c: default distinct row count")
  -- Note: if default changes to all, update this to assertEquals(#r, 3)
end

-- 112d. select distinct on single scalar expression
do
  local data = {
    { v = "x" },
    { v = "y" },
    { v = "x" },
    { v = "z" },
    { v = "y" },
  }

  local r = query [[
    from
      p = data
    select distinct
      p.v
    order by
      p.v
  ]]

  assertEquals(#r, 3, "112d: row count")
  assertEquals(r[1], "x")
  assertEquals(r[2], "y")
  assertEquals(r[3], "z")
end

-- 112e. select all on single scalar expression
do
  local data = {
    { v = "x" },
    { v = "y" },
    { v = "x" },
    { v = "z" },
    { v = "y" },
  }

  local r = query [[
    from
      p = data
    select all
      p.v
    order by
      p.v
  ]]

  assertEquals(#r, 5, "112e: row count")
  assertEquals(r[1], "x")
  assertEquals(r[2], "x")
  assertEquals(r[3], "y")
  assertEquals(r[4], "y")
  assertEquals(r[5], "z")
end

-- 112f. select distinct with cross join
do
  local xs = {
    { v = 1 },
    { v = 1 },
  }
  local ys = {
    { v = 10 },
  }

  local r = query [[
    from
      a = xs,
      b = ys
    select distinct {
      av = a.v,
      bv = b.v,
    }
  ]]

  assertEquals(#r, 1, "112f: deduped cross join")
  assertEquals(r[1].av, 1)
  assertEquals(r[1].bv, 10)
end

-- 112g. select all with cross join keeps duplicates
do
  local xs = {
    { v = 1 },
    { v = 1 },
  }
  local ys = {
    { v = 10 },
  }

  local r = query [[
    from
      a = xs,
      b = ys
    select all {
      av = a.v,
      bv = b.v,
    }
  ]]

  assertEquals(#r, 2, "112g: all cross join keeps dupes")
  assertEquals(r[1].av, 1)
  assertEquals(r[2].av, 1)
end

-- 112h. select distinct with group by (group results are already unique)
do
  local data = {
    { cat = "a", val = 1 },
    { cat = "a", val = 2 },
    { cat = "b", val = 3 },
  }

  local r = query [[
    from
      p = data
    group by
      p.cat
    select distinct {
      cat = key,
      n   = count(),
    }
    order by
      cat
  ]]

  assertEquals(#r, 2, "112h: row count")
  assertEquals(r[1].cat, "a")
  assertEquals(r[1].n, 2)
  assertEquals(r[2].cat, "b")
  assertEquals(r[2].n, 1)
end

-- 112i. select all with where + order by + limit
do
  local data = {
    { name = "A", tag = "x" },
    { name = "B", tag = "x" },
    { name = "C", tag = "y" },
    { name = "D", tag = "x" },
  }

  local r = query [[
    from
      p = data
    where
      p.tag == "x"
    select all {
      tag = p.tag,
    }
    order by
      p.name
    limit
      2
  ]]

  -- All 3 matching rows have tag="x", select all keeps all, limit 2
  assertEquals(#r, 2, "112i: row count")
  assertEquals(r[1].tag, "x")
  assertEquals(r[2].tag, "x")
end

-- 112j. select distinct vs select all side by side
do
  local data = {
    { v = 1 },
    { v = 2 },
    { v = 1 },
    { v = 3 },
    { v = 2 },
    { v = 1 },
  }

  local rd = query [[
    from
      p = data
    select distinct
      p.v
    order by
      p.v
  ]]

  local ra = query [[
    from
      p = data
    select all
      p.v
    order by
      p.v
  ]]

  assertEquals(#rd, 3, "112j: distinct count")
  assertEquals(rd[1], 1)
  assertEquals(rd[2], 2)
  assertEquals(rd[3], 3)

  assertEquals(#ra, 6, "112j: all count")
  assertEquals(ra[1], 1)
  assertEquals(ra[2], 1)
  assertEquals(ra[3], 1)
  assertEquals(ra[4], 2)
  assertEquals(ra[5], 2)
  assertEquals(ra[6], 3)
end

-- 112k. select distinct on unbound access
do
  local data = {
    { tag = "x", val = 1 },
    { tag = "x", val = 1 },
    { tag = "y", val = 2 },
  }

  local r = query [[
    from
      data
    select distinct {
      tag = tag,
      val = val,
    }
    order by
      tag
  ]]

  assertEquals(#r, 2, "112k: row count")
  assertEquals(r[1].tag, "x")
  assertEquals(r[2].tag, "y")
end

-- 112l. select all on unbound access
do
  local data = {
    { tag = "x", val = 1 },
    { tag = "x", val = 1 },
    { tag = "y", val = 2 },
  }

  local r = query [[
    from
      data
    select all {
      tag = tag,
      val = val,
    }
    order by
      tag
  ]]

  assertEquals(#r, 3, "112l: row count")
  assertEquals(r[1].tag, "x")
  assertEquals(r[2].tag, "x")
  assertEquals(r[3].tag, "y")
end

-- 112m. select all with loop using (duplicates from predicate join kept)
do
  local xs = {
    { id = 1, name = "A" },
    { id = 1, name = "A" },
  }
  local ys = {
    { fk = 1, val = "p" },
  }

  local r = query [[
    from
      a = xs,
      loop using function(a, b)
        return a.id == b.fk
      end b = ys
    select all {
      n = a.name,
      v = b.val,
    }
  ]]

  assertEquals(#r, 2, "112m: all keeps predicate join dupes")
  assertEquals(r[1].n, "A")
  assertEquals(r[2].n, "A")
end

-- 112n. select distinct with loop using (duplicates from predicate join removed)
do
  local xs = {
    { id = 1, name = "A" },
    { id = 1, name = "A" },
  }
  local ys = {
    { fk = 1, val = "p" },
  }

  local r = query [[
    from
      a = xs,
      loop using function(a, b)
        return a.id == b.fk
      end b = ys
    select distinct {
      n = a.name,
      v = b.val,
    }
  ]]

  assertEquals(#r, 1, "112n: distinct removes predicate join dupes")
  assertEquals(r[1].n, "A")
  assertEquals(r[1].v, "p")
end

-- 113. loop using on non-leaf left side sees the full left row

do
  local as = {
    { aid = 1 },
    { aid = 2 },
  }
  local bs = {
    { aid = 1, bid = 10 },
    { aid = 2, bid = 20 },
  }
  local cs = {
    { bid = 10, val = "x" },
    { bid = 20, val = "y" },
  }

  local r = query [[
    from
      a = as,
      loop using function(a, b)
        return a.aid == b.aid
      end b = bs,
      loop using function(left, c)
        return left.b.bid == c.bid
      end c = cs
    select {
      aid = a.aid,
      bid = b.bid,
      val = c.val,
    }
    order by
      aid
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].aid, 1)
  assertEquals(r[1].bid, 10)
  assertEquals(r[1].val, "x")
  assertEquals(r[2].aid, 2)
  assertEquals(r[2].bid, 20)
  assertEquals(r[2].val, "y")
end

-- 114. loop using on non-leaf left side can inspect multiple prior bindings

do
  local users = {
    { uid = 1, org = "eng" },
    { uid = 2, org = "sales" },
  }
  local memberships = {
    { uid = 1, team = "compiler" },
    { uid = 2, team = "field" },
  }
  local permissions = {
    { org = "eng", team = "compiler", perm = "write" },
    { org = "sales", team = "field", perm = "read" },
    { org = "eng", team = "field", perm = "deny" },
  }

  local r = query [[
    from
      u = users,
      loop using function(u, m)
        return u.uid == m.uid
      end m = memberships,
      loop using function(left, p)
        return left.u.org == p.org and left.m.team == p.team
      end p = permissions
    select {
      uid = u.uid,
      team = m.team,
      perm = p.perm,
    }
    order by
      uid
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].uid, 1)
  assertEquals(r[1].team, "compiler")
  assertEquals(r[1].perm, "write")
  assertEquals(r[2].uid, 2)
  assertEquals(r[2].team, "field")
  assertEquals(r[2].perm, "read")
end

-- 115. loop using preserves existing two-source semantics (left arg is source item)

do
  local xs = {
    { id = 1, name = "A" },
    { id = 2, name = "B" },
  }
  local ys = {
    { fk = 1, val = "p" },
    { fk = 2, val = "q" },
    { fk = 1, val = "r" },
  }

  local r = query [[
    from
      a = xs,
      loop using function(a, b)
        return a.id == b.fk
      end b = ys
    select {
      n = a.name,
      v = b.val,
    }
    order by
      a.name, b.val
  ]]

  assertEquals(#r, 3)
  assertEquals(r[1].n, "A")
  assertEquals(r[1].v, "p")
  assertEquals(r[2].n, "A")
  assertEquals(r[2].v, "r")
  assertEquals(r[3].n, "B")
  assertEquals(r[3].v, "q")
end

-- 116. explicit single-source pushdown remains correct

do
  local xs = {
    { size = 5, name = "a" },
    { size = 20, name = "b" },
    { size = 30, name = "c" },
  }
  local ys = {
    { tag = "x" },
    { tag = "y" },
  }

  local r = query [[
    from
      x = xs,
      y = ys
    where
      x.size > 10
    select {
      pair = x.name .. ":" .. y.tag,
    }
    order by
      x.name, y.tag
  ]]

  assertEquals(#r, 4)
  assertEquals(r[1].pair, "b:x")
  assertEquals(r[2].pair, "b:y")
  assertEquals(r[3].pair, "c:x")
  assertEquals(r[4].pair, "c:y")
end

-- 117. unqualified field references are not pushed down

do
  local size = 10
  local xs = {
    { size = 5, name = "a" },
    { size = 20, name = "b" },
  }
  local ys = {
    { tag = "x" },
  }

  local r = query [[
    from
      x = xs,
      y = ys
    where
      size > 10
    select {
      name = x.name,
    }
  ]]

  -- In multi-source queries, bare `size` is not an explicitly single-source
  -- reference, so it must not be pushed into x. It resolves from outer env.
  assertEquals(#r, 0)
end

-- 118. equi join with boolean keys works through hash join

do
  local xs = {
    { ok = true,  name = "a" },
    { ok = false, name = "b" },
    { ok = true,  name = "c" },
  }
  local ys = {
    { ok = true,  code = "T" },
    { ok = false, code = "F" },
  }

  local r = query [[
    from
      x = xs,
      hash y = ys
    where
      x.ok == y.ok
    select {
      pair = x.name .. ":" .. y.code,
    }
    order by
      x.name, y.code
  ]]

  assertEquals(#r, 3)
  assertEquals(r[1].pair, "a:T")
  assertEquals(r[2].pair, "b:F")
  assertEquals(r[3].pair, "c:T")
end

-- 119. hash join ignores nil join keys

do
  local xs = {
    { id = 1, name = "a" },
    { name = "b" },
    { id = 2, name = "c" },
  }
  local ys = {
    { fk = 1, val = "x" },
    { fk = 2, val = "y" },
    { val = "z" },
  }

  local r = query [[
    from
      x = xs,
      hash y = ys
    where
      x.id == y.fk
    select {
      pair = x.name .. ":" .. y.val,
    }
    order by
      x.name, y.val
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].pair, "a:x")
  assertEquals(r[2].pair, "c:y")
end

-- 120. loop using still supports inequality joins

do
  local xs = {
    { v = 1 },
    { v = 2 },
    { v = 3 },
  }
  local ys = {
    { v = 2 },
    { v = 3 },
    { v = 4 },
  }

  local joined = query [[
    from
      a = xs,
      loop using function(a, b)
        return a.v < b.v
      end b = ys
    select {
      pair = a.v .. ":" .. b.v,
    }
    order by
      a.v, b.v
  ]]

  assertEquals(#joined, 6)
  assertEquals(joined[1].pair, "1:2")
  assertEquals(joined[2].pair, "1:3")
  assertEquals(joined[3].pair, "1:4")
  assertEquals(joined[4].pair, "2:3")
  assertEquals(joined[5].pair, "2:4")
  assertEquals(joined[6].pair, "3:4")
end

-- 121. explicit single-source filter plus join predicate still works

do
  local users = {
    { uid = 1, active = true },
    { uid = 2, active = false },
    { uid = 3, active = true },
  }
  local events = {
    { uid = 1, kind = "a" },
    { uid = 1, kind = "b" },
    { uid = 2, kind = "c" },
    { uid = 3, kind = "d" },
  }

  local r = query [[
    from
      u = users,
      loop using function(u, e)
        return u.uid == e.uid
      end e = events
    where
      u.active
    select {
      pair = u.uid .. ":" .. e.kind,
    }
    order by
      u.uid, e.kind
  ]]

  assertEquals(#r, 3)
  assertEquals(r[1].pair, "1:a")
  assertEquals(r[2].pair, "1:b")
  assertEquals(r[3].pair, "3:d")
end

-- 122. conservative pushdown does not change outer-variable semantics

do
  local threshold = 15
  local xs = {
    { v = 10, name = "a" },
    { v = 20, name = "b" },
    { v = 30, name = "c" },
  }
  local ys = {
    { tag = "x" },
  }

  local r = query [[
    from
      x = xs,
      y = ys
    where
      x.v > threshold
    select {
      name = x.name,
    }
    order by
      x.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "b")
  assertEquals(r[2].name, "c")
end

-- 123. full-row left argument on deeper join can still project original aliases

do
  local arows = {
    { id = 1, name = "A" },
  }
  local brows = {
    { aid = 1, bid = 100 },
  }
  local crows = {
    { bid = 100, label = "ok" },
  }

  local r = query [[
    from
      a = arows,
      loop using function(a, b)
        return a.id == b.aid
      end b = brows,
      loop using function(left, c)
        return left.a.id == 1 and left.b.bid == c.bid
      end c = crows
    select {
      pair = a.name .. ":" .. c.label,
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].pair, "A:ok")
end

-- 124. missing named predicate reference errors cleanly

do
  local ok, err = pcall(function()
    local xs = {
      { id = 1 },
    }
    local ys = {
      { fk = 1 },
    }

    local _r = query [[
      from
        a = xs,
        loop using missingPredicate b = ys
      select {
        id = a.id,
      }
    ]]
  end)

  assertEquals(ok, false)
  assertTrue(
    string.find(
      tostring(err),
      "'using' predicate \"missingPredicate\" is not defined"
    ) ~= nil,
    "expected missing predicate error, got: " .. tostring(err)
  )
end

-- 125. semi join with equi predicate keeps matching left rows only

do
  local xs = {
    { id = 1, name = "a" },
    { id = 2, name = "b" },
    { id = 3, name = "c" },
  }
  local ys = {
    { fk = 2 },
    { fk = 3 },
  }

  local r = query [[
    from
      x = xs,
      semi hash y = ys
    where
      x.id == y.fk
    select {
      name = x.name,
    }
    order by
      x.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "b")
  assertEquals(r[2].name, "c")
end

-- 126. anti join with equi predicate keeps non-matching left rows only

do
  local xs = {
    { id = 1, name = "a" },
    { id = 2, name = "b" },
    { id = 3, name = "c" },
  }
  local ys = {
    { fk = 2 },
    { fk = 3 },
  }

  local r = query [[
    from
      x = xs,
      anti hash y = ys
    where
      x.id == y.fk
    select {
      name = x.name,
    }
    order by
      x.name
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].name, "a")
end

-- 127. semi join with loop using predicate works

do
  local xs = {
    { id = 1, name = "a" },
    { id = 2, name = "b" },
    { id = 3, name = "c" },
  }
  local ys = {
    { fk = 2 },
    { fk = 3 },
  }

  local r = query [[
    from
      x = xs,
      semi loop using function(x, y)
        return x.id == y.fk
      end y = ys
    select {
      name = x.name,
    }
    order by
      x.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "b")
  assertEquals(r[2].name, "c")
end

-- 127b. explain shows semi loop join type

do
  local xs = {
    { id = 1, name = "a" },
    { id = 2, name = "b" },
    { id = 3, name = "c" },
  }
  local ys = {
    { fk = 2 },
    { fk = 3 },
  }

  local plan = query [[
    explain
    from
      x = xs,
      semi loop using function(x, y)
        return x.id == y.fk
      end y = ys
    select {
      name = x.name,
    }
  ]]

  assertTrue(
    string.find(plan, "Semi") ~= nil,
    "expected explain output to mention semi join, got: " .. tostring(plan)
  )
end

-- 127c. explain shows anti loop join type

do
  local xs = {
    { id = 1, name = "a" },
    { id = 2, name = "b" },
    { id = 3, name = "c" },
  }
  local ys = {
    { fk = 2 },
    { fk = 3 },
  }

  local plan = query [[
    explain
    from
      x = xs,
      anti loop using function(x, y)
        return x.id == y.fk
      end y = ys
    select {
      name = x.name,
    }
  ]]

  assertTrue(
    string.find(plan, "Anti") ~= nil,
    "expected explain output to mention anti join, got: " .. tostring(plan)
  )
end

-- 128. anti join with loop using predicate works

do
  local xs = {
    { id = 1, name = "a" },
    { id = 2, name = "b" },
    { id = 3, name = "c" },
  }
  local ys = {
    { fk = 2 },
    { fk = 3 },
  }

  local r = query [[
    from
      x = xs,
      anti loop using function(x, y)
        return x.id == y.fk
      end y = ys
    select {
      name = x.name,
    }
    order by
      x.name
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].name, "a")
end

-- 129. semi join preserves left multiplicity only

do
  local xs = {
    { id = 1, name = "a1" },
    { id = 1, name = "a2" },
    { id = 2, name = "b" },
  }
  local ys = {
    { fk = 1 },
    { fk = 1 },
  }

  local r = query [[
    from
      x = xs,
      semi hash y = ys
    where
      x.id == y.fk
    select all {
      name = x.name,
    }
    order by
      x.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "a1")
  assertEquals(r[2].name, "a2")
end

-- 130. anti join preserves unmatched left multiplicity only

do
  local xs = {
    { id = 1, name = "a1" },
    { id = 1, name = "a2" },
    { id = 2, name = "b1" },
    { id = 2, name = "b2" },
  }
  local ys = {
    { fk = 1 },
  }

  local r = query [[
    from
      x = xs,
      anti hash y = ys
    where
      x.id == y.fk
    select all {
      name = x.name,
    }
    order by
      x.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "b1")
  assertEquals(r[2].name, "b2")
end

-- 131. semi join with non-leaf left side can inspect full left row

do
  local users = {
    { uid = 1, org = "eng" },
    { uid = 2, org = "sales" },
  }
  local memberships = {
    { uid = 1, team = "compiler" },
    { uid = 2, team = "field" },
  }
  local permissions = {
    { org = "eng", team = "compiler" },
    { org = "eng", team = "field" },
  }

  local r = query [[
    from
      u = users,
      loop using function(u, m)
        return u.uid == m.uid
      end m = memberships,
      semi loop using function(left, p)
        return left.u.org == p.org and left.m.team == p.team
      end p = permissions
    select {
      pair = u.uid .. ":" .. m.team,
    }
    order by
      u.uid, m.team
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].pair, "1:compiler")
end

-- 132. anti join with non-leaf left side can inspect full left row

do
  local users = {
    { uid = 1, org = "eng" },
    { uid = 2, org = "sales" },
  }
  local memberships = {
    { uid = 1, team = "compiler" },
    { uid = 2, team = "field" },
  }
  local permissions = {
    { org = "eng", team = "compiler" },
  }

  local r = query [[
    from
      u = users,
      loop using function(u, m)
        return u.uid == m.uid
      end m = memberships,
      anti loop using function(left, p)
        return left.u.org == p.org and left.m.team == p.team
      end p = permissions
    select {
      pair = u.uid .. ":" .. m.team,
    }
    order by
      u.uid, m.team
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].pair, "2:field")
end

-- 133. semi join without predicate errors

do
  local ok, err = pcall(function()
    local xs = {
      { id = 1 },
      { id = 2 },
    }
    local ys = {
      { fk = 2 },
    }

    local _r = query [[
      from
        x = xs,
        semi loop y = ys
      select {
        id = x.id,
      }
    ]]
  end)

  assertEquals(ok, false)
  assertTrue(
    string.find(
      tostring(err),
      "'semi' join with 'loop' method requires 'using' predicate"
    ) ~= nil,
    "expected semi loop predicate error, got: " .. tostring(err)
  )
end

-- 134. anti join without predicate errors

do
  local ok, err = pcall(function()
    local xs = {
      { id = 1 },
      { id = 2 },
    }
    local ys = {
      { fk = 2 },
    }

    local _r = query [[
      from
        x = xs,
        anti hash y = ys
      select {
        id = x.id,
      }
    ]]
  end)

  assertEquals(ok, false)
  assertTrue(
    string.find(
      tostring(err),
      "'anti' join with 'loop' method requires 'using' predicate"
    ) ~= nil,
    "expected anti join predicate error, got: " .. tostring(err)
  )
end

-- 135. hinted hash join keeps correct equi-predicate orientation

do
  local xs = {
    { ok = true,  name = "a" },
    { ok = false, name = "b" },
    { ok = true,  name = "c" },
  }
  local ys = {
    { ok = true,  code = "T" },
    { ok = false, code = "F" },
  }

  local r = query [[
    from
      x = xs,
      hash y = ys
    where
      x.ok == y.ok
    select {
      pair = x.name .. ":" .. y.code,
    }
    order by
      x.name, y.code
  ]]

  assertEquals(#r, 3)
  assertEquals(r[1].pair, "a:T")
  assertEquals(r[2].pair, "b:F")
  assertEquals(r[3].pair, "c:T")
end

-- 136. width-sensitive planning prefers narrower source before wider source

do
  local base = {}
  local small = {}
  local wide = {}

  for i = 1, 50 do
    base[i] = { id = i }

    small[i] = {
      id = i,
      k = i,
    }

    wide[i] = {
      id = i,
      k = i,
      a1 = "x", a2 = "x", a3 = "x", a4 = "x", a5 = "x",
      a6 = "x", a7 = "x", a8 = "x", a9 = "x", a10 = "x",
      a11 = "x", a12 = "x", a13 = "x", a14 = "x", a15 = "x",
    }
  end

  local plan = query [[
    explain
    from
      b = base,
      w = wide,
      s = small
    where
      b.id == w.id and b.id == s.id
    select {
      id = b.id
    }
  ]]

  local function scan_pos_for_alias(p, alias)
    for _, pat in ipairs({
      "Seq Scan on " .. alias,
      "Index Scan on " .. alias,
      "Index Only Scan on " .. alias,
      "Function Seq Scan on " .. alias,
    }) do
      local pos = string.find(p, pat, 1, true)
      if pos then return pos end
    end
    return nil
  end

  local sPos = scan_pos_for_alias(plan, "s")
  local wPos = scan_pos_for_alias(plan, "w")

  assert(sPos ~= nil)
  assert(wPos ~= nil)
  assert(sPos < wPos)
end

-- 137. GroupAggregate estimate uses NDV for single grouping key

do
  local rows = {}

  for i = 1, 10 do
    for j = 1, 3 do
      rows[#rows + 1] = {
        name = "page-" .. i,
        v = j,
      }
    end
  end

  local plan = query [[
    explain (costs)
    from
      r = rows
    group by
      r.name
    select {
      key = r.name,
      c = count(r.v),
    }
  ]]

  assertTrue(
    string.find(plan, "Hash Aggregate", 1, true) ~= nil,
    "136: expected Hash Aggregate in plan, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "rows=10", 1, true) ~= nil,
    "136: expected rows=10 in plan, got: " .. tostring(plan)
  )
end

-- 138. GroupAggregate falls back when grouping expression is not a simple source column

do
  local rows = {}

  for i = 1, 10 do
    for j = 1, 3 do
      rows[#rows + 1] = {
        name = "page-" .. i,
        v = j,
      }
    end
  end

  local plan = query [[
    explain (costs)
    from
      r = rows
    group by
      r.name .. ""
    select {
      key = r.name .. "",
      c = count(r.v),
    }
  ]]

  assertTrue(
    string.find(plan, "Hash Aggregate", 1, true) ~= nil,
    "137: expected Hash Aggregate in plan, got: " .. tostring(plan)
  )
  -- 30 input rows -> fallback heuristic 15
  assertTrue(
    string.find(plan, "rows=15", 1, true) ~= nil,
    "137: expected fallback rows=15 in plan, got: " .. tostring(plan)
  )
end

-- 139. GroupAggregate NDV estimate for multiple keys is capped by input rows

do
  local rows = {}

  for i = 1, 10 do
    for j = 1, 3 do
      rows[#rows + 1] = {
        a = "a-" .. i,
        b = "b-" .. j,
        v = i * j,
      }
    end
  end

  local plan = query [[
    explain (costs)
    from
      r = rows
    group by
      r.a, r.b
    select {
      a = r.a,
      b = r.b,
      c = count(r.v),
    }
  ]]

  assertTrue(
    string.find(plan, "Hash Aggregate", 1, true) ~= nil,
    "138: expected Hash Aggregate in plan, got: " .. tostring(plan)
  )
  -- NDV(a)=10, NDV(b)=3, product=30, capped by input rows=30
  assertTrue(
    string.find(plan, "rows=30", 1, true) ~= nil,
    "138: expected capped rows=30 in plan, got: " .. tostring(plan)
  )
end

-- 140. Multi-source inner equi join applies join predicate

do
  local depts = {
    { dept = "eng" },
    { dept = "sales" },
  }
  local employees = {
    { name = "Alice", dept = "eng" },
    { name = "Bob",   dept = "eng" },
    { name = "Carol", dept = "sales" },
  }
  local r = query [[
    from
      d = depts,
      e = employees
    where
      d.dept == e.dept
    select all {
      dept = d.dept,
      name = e.name,
    }
    order by
      dept, name
  ]]

  assertEquals(#r, 3)
  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].dept, "eng")
  assertEquals(r[2].name, "Bob")
  assertEquals(r[3].dept, "sales")
  assertEquals(r[3].name, "Carol")
end

-- 141. Multi-source group by + count uses filtered join rows

do
  local depts = {
    { dept = "eng" },
    { dept = "sales" },
  }
  local employees = {
    { name = "Alice", dept = "eng" },
    { name = "Bob",   dept = "eng" },
    { name = "Carol", dept = "sales" },
  }
  local r = query [[
    from
      d = depts,
      e = employees
    where
      d.dept == e.dept
    group by
      d.dept
    select {
      dept = key,
      n = count(),
    }
    order by
      dept
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].n, 2)
  assertEquals(r[2].dept, "sales")
  assertEquals(r[2].n, 1)
end

-- 142. Multi-source group by + sum uses filtered join rows

do
  local categories = {
    { cat = "fruit" },
    { cat = "veg" },
  }
  local items = {
    { name = "apple",  cat = "fruit", price = 3 },
    { name = "pear",   cat = "fruit", price = 2 },
    { name = "carrot", cat = "veg",   price = 1 },
    { name = "beet",   cat = "veg",   price = 4 },
  }
  local r = query [[
    from
      c = categories,
      i = items
    where
      c.cat == i.cat
    group by
      c.cat
    select {
      cat = key,
      total = sum(i.price),
    }
    order by
      cat
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].cat, "fruit")
  assertEquals(r[1].total, 5)
  assertEquals(r[2].cat, "veg")
  assertEquals(r[2].total, 5)
end

-- 143. Semi join with equi predicate keeps matching left rows only

do
  local xs = {
    { id = 1, name = "a" },
    { id = 2, name = "b" },
    { id = 3, name = "c" },
  }
  local ys = {
    { fk = 2 },
    { fk = 3 },
  }

  local r = query [[
    from
      x = xs,
      semi hash y = ys
    where
      x.id == y.fk
    select {
      name = x.name,
    }
    order by
      x.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "b")
  assertEquals(r[2].name, "c")
end

-- 144. Anti join with equi predicate keeps non-matching left rows only

do
  local xs = {
    { id = 1, name = "a" },
    { id = 2, name = "b" },
    { id = 3, name = "c" },
  }
  local ys = {
    { fk = 2 },
    { fk = 3 },
  }

  local r = query [[
    from
      x = xs,
      anti hash y = ys
    where
      x.id == y.fk
    select {
      name = x.name,
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].name, "a")
end

-- 145. Explain works for from {}

do
  local plan = query [[
    explain (costs)
    from
      {}
    select
      _
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Seq Scan on _", 1, true) ~= nil
      or string.find(plan, "Index Scan on _", 1, true) ~= nil
      or string.find(plan, "Index Only Scan on _", 1, true) ~= nil,
    "104: expected scan on _, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "rows=", 1, true) ~= nil,
    "104: expected row estimate, got: " .. tostring(plan)
  )
end

-- 146. Distinct explain analyze works

do
  local plan = query [[
    explain analyze (costs, timing)
    from
      p = pages
    where
      p.tags[1] ~= nil
    select {
      tag = p.tags[1],
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Unique", 1, true) ~= nil,
    "105: expected Unique node, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "actual", 1, true) ~= nil,
    "105: expected analyze actuals, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Execution Time:", 1, true) ~= nil,
    "105: expected execution time, got: " .. tostring(plan)
  )
end

-- 147. materialized join source with hash hint

do
  local xs = {
    { id = 1, name = "a" },
    { id = 2, name = "b" },
    { id = 3, name = "c" },
  }
  local ys = {
    { fk = 2, val = "x" },
    { fk = 3, val = "y" },
  }

  local r = query [[
    from
      materialized x = xs,
      hash y = ys
    where
      x.id == y.fk
    select all {
      name = x.name,
      val = y.val,
    }
    order by
      x.name
  ]]
  assertEquals(#r, 2)
  assertEquals(r[1].name, "b")
  assertEquals(r[1].val, "x")
  assertEquals(r[2].name, "c")
  assertEquals(r[2].val, "y")
end

-- 148. with rows/width/cost hints appear in explain

do
  local plan = query [[
    explain verbose hints
    from
      p = pages with rows 7 width 3 cost 11
    select {
      name = p.name,
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Seq Scan on p", 1, true) ~= nil
      or string.find(plan, "Index Scan on p", 1, true) ~= nil
      or string.find(plan, "Index Only Scan on p", 1, true) ~= nil,
    "148: expected scan on p, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Hints: rows=7, width=3, cost=11", 1, true) ~= nil,
    "148: expected hinted source metadata, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Stats: computed-exact-small", 1, true) ~= nil,
    "148: expected hinted stats source, got: " .. tostring(plan)
  )
end

-- 149. materialized + with hints both appear in explain

do
  local plan = query [[
    explain verbose hints
    from
      materialized p = pages with rows 5 width 2 cost 13
    select {
      name = p.name,
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Hints: materialized, rows=5, width=2, cost=13", 1, true) ~= nil,
    "149: expected materialized+hints metadata, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Stats: computed-exact-small", 1, true) ~= nil,
    "149: expected hinted stats source, got: " .. tostring(plan)
  )
end

-- 150. later with-hint entries override earlier ones

do
  local plan = query [[
    explain verbose hints
    from
      p = pages with rows 7 rows 9 width 3 width 4 cost 11 cost 12
    select {
      name = p.name,
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Hints: rows=9, width=4, cost=12", 1, true) ~= nil,
    "150: expected last with-hints to win, got: " .. tostring(plan)
  )
end

-- 151. Aggregate filter analyze statistics

-- 151a. Implicit aggregate filter reports removed rows
do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { v = 10, keep = true },
        { v = 20, keep = false },
        { v = 30, keep = false },
        { v = 40, keep = false },
      }
    select {
      total = sum(t.v) filter(where t.keep == true),
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Implicit Group Aggregation", 1, true) ~= nil,
    "151a: expected implicit group aggregation, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Filter:", 1, true) ~= nil,
    "151a: expected filter line, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 3", 1, true) ~= nil,
    "151a: expected removed-row count 3, got: " .. tostring(plan)
  )
end

-- 151b. Explicit grouping aggregate filter reports removed rows across groups
do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { g = "a", v = 1, keep = true },
        { g = "a", v = 2, keep = false },
        { g = "b", v = 3, keep = false },
        { g = "b", v = 4, keep = false },
        { g = "b", v = 5, keep = true },
      }
    group by
      t.g
    select {
      g = key,
      total = sum(t.v) filter(where t.keep == true),
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Hash Aggregate", 1, true) ~= nil,
    "151b: expected Hash Aggregate node, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 3", 1, true) ~= nil,
    "151b: expected removed-row count 3, got: " .. tostring(plan)
  )
end

-- 151c. Aggregate filter with intra-aggregate order by still reports removed rows
do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { v = 10, k = 4, keep = true },
        { v = 20, k = 3, keep = false },
        { v = 30, k = 2, keep = false },
        { v = 40, k = 1, keep = false },
      }
    select {
      xs = array_agg(t.v order by t.k desc) filter(where t.keep == true),
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Sort %(Group%)") ~= nil,
    "151c: expected group sort node, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Implicit Group Aggregation", 1, true) ~= nil,
    "151c: expected implicit group aggregation, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Filter:", 1, true) ~= nil,
    "151c: expected filter line, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 3", 1, true) ~= nil,
    "151c: expected removed-row count 3, got: " .. tostring(plan)
  )
end

-- 151d. Same filtered aggregate used in select and having is counted once
do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { g = "a", v = 1, keep = true },
        { g = "a", v = 2, keep = false },
        { g = "b", v = 3, keep = false },
        { g = "b", v = 4, keep = false },
        { g = "b", v = 5, keep = true },
      }
    group by
      t.g
    having
      sum(t.v) filter(where t.keep == true) > 0
    select {
      g = key,
      total = sum(t.v) filter(where t.keep == true),
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Hash Aggregate", 1, true) ~= nil,
    "151d: expected Hash Aggregate node, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Filter:", 1, true) ~= nil,
    "151d: expected filter line, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 3", 1, true) ~= nil,
    "151d: expected deduped removed-row count 3, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 6", 1, true) == nil,
    "151d: aggregate filter rows must not be double-counted: " .. tostring(plan)
  )
end

-- 151e. Embedded from-data form also reports aggregate-filter removed rows
do
  local plan = query [[
    explain analyze verbose
    from
      data = {
        { v = 10, keep = true },
        { v = 20, keep = false },
        { v = 30, keep = false },
        { v = 40, keep = false },
      }
    select {
      total = sum(data.v) filter(where data.keep == true),
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Seq Scan on data", 1, true) ~= nil
      or string.find(plan, "Function Seq Scan on data", 1, true) ~= nil
      or string.find(plan, "Index Scan on data", 1, true) ~= nil
      or string.find(plan, "Index Only Scan on data", 1, true) ~= nil,
    "151e: expected scan on data, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 3", 1, true) ~= nil,
    "151e: expected removed-row count 3, got: " .. tostring(plan)
  )
end

-- 152. Aggregate filter rows are deduped across having + select + order by

do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { g = "a", v = 1, keep = true },
        { g = "a", v = 2, keep = false },
        { g = "b", v = 3, keep = false },
        { g = "b", v = 4, keep = false },
        { g = "b", v = 5, keep = true },
      }
    group by
      t.g
    having
      sum(t.v) filter(where t.keep == true) > 0
    select {
      g = key,
      total = sum(t.v) filter(where t.keep == true),
    }
    order by
      sum(t.v) filter(where t.keep == true) desc
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 3", 1, true) ~= nil,
    "152: expected deduped removed-row count 3, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 6", 1, true) == nil,
    "152: aggregate filter rows must not be double-counted across having/select/order by: " .. tostring(plan)
  )
end

-- 152a. Different aggregate filters are counted independently

do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { g = "a", v = 1, keep = true,  hot = false },
        { g = "a", v = 2, keep = false, hot = true  },
        { g = "b", v = 3, keep = false, hot = false },
        { g = "b", v = 4, keep = false, hot = true  },
        { g = "b", v = 5, keep = true,  hot = true  },
      }
    group by
      t.g
    select {
      kept = sum(t.v) filter(where t.keep == true),
      hot  = sum(t.v) filter(where t.hot == true),
    }
  ]]

  plan = tostring(plan)

  -- keep=false rows removed: 3
  -- hot=false rows removed: 2
  -- total should be 5
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 5", 1, true) ~= nil,
    "152a: expected combined removed-row count 5 for distinct aggregate filters, got: " .. tostring(plan)
  )
end

-- 152b. Different order-by aggregates must not alias by position

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

-- 152c. Repeated identical aggregates inside one select are deduped for stats and value

do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { g = "a", v = 1, keep = true },
        { g = "a", v = 2, keep = false },
        { g = "a", v = 3, keep = false },
        { g = "b", v = 4, keep = true },
      }
    group by
      t.g
    select {
      x = sum(t.v) filter(where t.keep == true),
      y = sum(t.v) filter(where t.keep == true),
    }
  ]]

  plan = tostring(plan)

  -- Only two rows fail keep==true across all input rows.
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 2", 1, true) ~= nil,
    "152c: expected repeated identical aggregates in one select to count once, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 4", 1, true) == nil,
    "152c: repeated identical aggregates in one select must not double-count: " .. tostring(plan)
  )

  local r = query [[
    from
      t = {
        { g = "a", v = 1, keep = true },
        { g = "a", v = 2, keep = false },
        { g = "a", v = 3, keep = false },
        { g = "b", v = 4, keep = true },
      }
    group by
      t.g
    order by
      key
    select {
      g = key,
      x = sum(t.v) filter(where t.keep == true),
      y = sum(t.v) filter(where t.keep == true),
    }
  ]]

  assertEquals(r[1].g, "a")
  assertEquals(r[1].x, 1)
  assertEquals(r[1].y, 1)
  assertEquals(r[2].g, "b")
  assertEquals(r[2].x, 4)
  assertEquals(r[2].y, 4)
end

-- 152d. Repeated identical aggregates across having and select are deduped

do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { g = "a", v = 1, keep = true },
        { g = "a", v = 2, keep = false },
        { g = "b", v = 3, keep = false },
        { g = "b", v = 4, keep = true },
      }
    group by
      t.g
    having
      sum(t.v) filter(where t.keep == true) > 0
    select {
      g = key,
      total = sum(t.v) filter(where t.keep == true),
      again = sum(t.v) filter(where t.keep == true),
    }
  ]]

  plan = tostring(plan)

  -- Two rows fail keep==true across all input rows.
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 2", 1, true) ~= nil,
    "152d: expected dedupe across having and repeated select aggregates, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 4", 1, true) == nil,
    "152d: aggregate filter rows must not be recounted across having/select: " .. tostring(plan)
  )
end

-- 152e. Aggregate without filter does not contribute removed-row stats

do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { g = "a", v = 1 },
        { g = "a", v = 2 },
        { g = "b", v = 3 },
      }
    group by
      t.g
    select {
      total = sum(t.v),
      n = count(),
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter:", 1, true) == nil,
    "152e: aggregates without filter must not report removed-row stats: " .. tostring(plan)
  )
end

-- 152f. Mixed filtered and unfiltered aggregates only count filtered removals

do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { g = "a", v = 1, keep = true },
        { g = "a", v = 2, keep = false },
        { g = "b", v = 3, keep = false },
        { g = "b", v = 4, keep = true },
      }
    group by
      t.g
    select {
      total = sum(t.v),
      kept = sum(t.v) filter(where t.keep == true),
      n = count(),
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 2", 1, true) ~= nil,
    "152f: only filtered aggregates should contribute removed-row count, got: " .. tostring(plan)
  )
end

-- 152g. Same aggregate function, same args, different order by are distinct

do
  local r = query [[
    from
      t = {
        { g = "x", name = "a", k = 2 },
        { g = "x", name = "b", k = 3 },
        { g = "x", name = "c", k = 1 },
      }
    group by
      t.g
    select {
      asc_names = array_agg(t.name order by t.k asc),
      desc_names = array_agg(t.name order by t.k desc),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].asc_names[1], "c")
  assertEquals(r[1].asc_names[2], "a")
  assertEquals(r[1].asc_names[3], "b")
  assertEquals(r[1].desc_names[1], "b")
  assertEquals(r[1].desc_names[2], "a")
  assertEquals(r[1].desc_names[3], "c")
end

-- 152h. Same aggregate function, same args, different filter are distinct

do
  local r = query [[
    from
      t = {
        { g = "x", v = 1, keep = true,  hot = false },
        { g = "x", v = 2, keep = false, hot = true  },
        { g = "x", v = 3, keep = true,  hot = true  },
      }
    group by
      t.g
    select {
      kept = sum(t.v) filter(where t.keep == true),
      hot  = sum(t.v) filter(where t.hot == true),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].kept, 4)
  assertEquals(r[1].hot, 5)
end

-- 152i. Aggregate filter stats survive distinct/limit pipeline stages

do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { g = "a", v = 1, keep = true },
        { g = "a", v = 2, keep = false },
        { g = "b", v = 3, keep = false },
        { g = "b", v = 4, keep = true },
      }
    group by
      t.g
    select distinct {
      total = sum(t.v) filter(where t.keep == true),
    }
    limit
      1
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 2", 1, true) ~= nil,
    "152i: downstream distinct/limit must not disturb aggregate filter stats: " .. tostring(plan)
  )
end

-- 152j. Empty aggregate filter result still dedupes correctly

do
  local plan = query [[
    explain analyze verbose
    from
      t = {
        { g = "a", v = 1, keep = false },
        { g = "a", v = 2, keep = false },
        { g = "b", v = 3, keep = false },
      }
    group by
      t.g
    having
      count() >= 1
    select {
      s1 = sum(t.v) filter(where t.keep == true),
      s2 = sum(t.v) filter(where t.keep == true),
    }
  ]]

  plan = tostring(plan)

  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 3", 1, true) ~= nil,
    "152j: empty filtered aggregates should still count removed rows once, got: " .. tostring(plan)
  )
  assertTrue(
    string.find(plan, "Rows Removed by Aggregate Filter: 6", 1, true) == nil,
    "152j: empty filtered aggregates must not double-count: " .. tostring(plan)
  )
end

-- 152k. Grouped order by on aggregate does not corrupt repeated select aggregates

do
  local r = query [[
    from
      t = {
        { g = "a", v = 1, keep = true },
        { g = "a", v = 2, keep = false },
        { g = "b", v = 3, keep = true },
        { g = "b", v = 4, keep = false },
      }
    group by
      t.g
    select {
      g = key,
      s1 = sum(t.v) filter(where t.keep == true),
      s2 = sum(t.v) filter(where t.keep == true),
    }
    order by
      sum(t.v) filter(where t.keep == true) desc
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].g, "b")
  assertEquals(r[1].s1, 3)
  assertEquals(r[1].s2, 3)
  assertEquals(r[2].g, "a")
  assertEquals(r[2].s1, 1)
  assertEquals(r[2].s2, 1)
end

-- 152l. Multi-source `explain analyze` must not lose track of source
-- aliases. Without `analyzeQuery.sourceNames` being threaded into the
-- post-join projection, wildcards (`t.*`, `p.*`, `*`, `*.col`) raise
-- `missing 'from' clause entry for table "t"` because the synthesised
-- joined row has no per-source structure for them to validate against.
do
  local ts = { { page = "p1", tag = "x" } }
  local ps = { { name = "p1", body = "hi" } }
  local plan = query [[
    explain analyze verbose hints
    from t = ts, p = ps
    where t.page == p.name
    select t.*, p.*, ['zup name'] = p.name
    limit 1
  ]]
  plan = tostring(plan)
  assertTrue(
    string.find(plan, "missing 'from' clause entry", 1, true) == nil,
    "152l: explain-analyze must resolve t.* / p.* against the join sources"
  )
  -- Sanity: the explain output should at least mention both sources.
  assertTrue(string.find(plan, "ts", 1, true) ~= nil, "152l: 'ts' in plan")
  assertTrue(string.find(plan, "ps", 1, true) ~= nil, "152l: 'ps' in plan")
end

-- 152m. Same query, plain `explain` (no analyze): must not regress. (This
-- already worked, but keep it next to 152l so a future change can't
-- silently break the variants.)
do
  local ts = { { page = "p1", tag = "x" } }
  local ps = { { name = "p1", body = "hi" } }
  local plan = query [[
    explain
    from t = ts, p = ps
    where t.page == p.name
    select t.*, p.*
    limit 1
  ]]
  plan = tostring(plan)
  assertTrue(
    string.find(plan, "missing 'from' clause entry", 1, true) == nil,
    "152m: wildcards must not error in plain explain"
  )
end

-- 152n. Same query, `explain verbose`: must also keep working.
do
  local ts = { { page = "p1", tag = "x" } }
  local ps = { { name = "p1", body = "hi" } }
  local plan = query [[
    explain verbose
    from t = ts, p = ps
    where t.page == p.name
    select t.*, p.*
    limit 1
  ]]
  plan = tostring(plan)
  assertTrue(
    string.find(plan, "missing 'from' clause entry", 1, true) == nil,
    "152n: wildcards must not error in 'explain verbose'"
  )
end

-- 152o. Bare `explain` (no verbose) MUST NOT emit any `Output:` lines.
-- This mirrors Postgres' `EXPLAIN`: the per-node target list is verbose-only.
do
  local ts = { { page = "p1", tag = "x" } }
  local ps = { { name = "p1", body = "hi" } }
  local plan = query [[
    explain
    from t = ts, p = ps
    where t.page == p.name
    select t.*, p.*
    limit 1
  ]]
  plan = tostring(plan)
  assertTrue(
    string.find(plan, "Output:", 1, true) == nil,
    "152o: bare explain must not show Output: lines"
  )
  -- `Result Columns:` is also verbose-only and analyze-only -- bare explain
  -- has neither, so it must be absent.
  assertTrue(
    string.find(plan, "Result Columns:", 1, true) == nil,
    "152o: bare explain must not show Result Columns:"
  )
end

-- 152p. `explain verbose` (no analyze): `Output:` lines appear with dotted
-- SQL-style refs (so users can copy them straight back into a where clause).
-- `Result Columns:` is gated on `analyze + verbose`, so it must NOT appear.
do
  local ts = { { page = "p1", tag = "x" } }
  local ps = { { name = "p1", body = "hi" } }
  local plan = query [[
    explain verbose
    from t = ts, p = ps
    where t.page == p.name
    select t.tag, x = p.body
    limit 1
  ]]
  plan = tostring(plan)
  -- Project's Output: shows the deparsed expressions (aliases dropped).
  assertTrue(
    string.find(plan, "Output: t.tag, p.body", 1, true) ~= nil,
    "152p: project Output must show dotted refs without aliases"
  )
  -- `Result Columns:` is analyze-only.
  assertTrue(
    string.find(plan, "Result Columns:", 1, true) == nil,
    "152p: explain verbose (no analyze) must not show Result Columns:"
  )
end

-- 152q. `explain analyze verbose` resolves the realised Lua-row keys into
-- a top-level `Result Columns:` line above the timing block. Multi-source
-- wildcards expand to underscore-qualified keys (Design A); explicit
-- aliases are preserved verbatim, and non-identifier keys are quoted.
do
  local ts = { { page = "p1", tag = "x" } }
  local ps = { { name = "p1", body = "hi" } }
  local plan = query [[
    explain analyze verbose
    from t = ts, p = ps
    where t.page == p.name
    select t.tag, p.body, ['zup name'] = p.name
    limit 1
  ]]
  plan = tostring(plan)
  -- Single-line `Result Columns:` carries the actual hash-table keys.
  assertTrue(
    string.find(plan, "Result Columns: t_tag, p_body, \"zup name\"", 1, true)
      ~= nil,
    "152q: Result Columns must show underscore-qualified Lua keys"
  )
  -- `Output:` still uses dotted SQL-style on the Project node.
  assertTrue(
    string.find(plan, "Output: t.tag, p.body, p.name", 1, true) ~= nil,
    "152q: Output: stays dotted/SQL-style under analyze + verbose"
  )
end

-- 152r. `explain analyze` (no verbose) must NOT show `Output:` or
-- `Result Columns:` -- both are gated on `verbose`.
do
  local ts = { { page = "p1", tag = "x" } }
  local ps = { { name = "p1", body = "hi" } }
  local plan = query [[
    explain analyze
    from t = ts, p = ps
    where t.page == p.name
    select t.*, p.*
    limit 1
  ]]
  plan = tostring(plan)
  assertTrue(
    string.find(plan, "Output:", 1, true) == nil,
    "152r: explain analyze (no verbose) must not show Output:"
  )
  assertTrue(
    string.find(plan, "Result Columns:", 1, true) == nil,
    "152r: explain analyze (no verbose) must not show Result Columns:"
  )
end

-- 152s. Single-source verbose explain emits unqualified column names on
-- the Scan node (Postgres' `useprefix=false`), and the Project still uses
-- the user's spelling.
do
  local pages_local = { { name = "Alice", age = 30 }, { name = "Bob", age = 25 } }
  local plan = query [[
    explain verbose
    from p = pages_local
    select p.name
    limit 1
  ]]
  plan = tostring(plan)
  -- Project's Output: respects what the user wrote (`p.name`).
  assertTrue(
    string.find(plan, "Output: p.name", 1, true) ~= nil,
    "152s: project Output must show p.name"
  )
end

-- 152t. `explain analyze verbose` for a wildcard select on a multi-source
-- query realises every expanded key into Result Columns:.
do
  local ts = { { page = "p1", tag = "x" } }
  local ps = { { name = "p1", body = "hi" } }
  local plan = query [[
    explain analyze verbose
    from t = ts, p = ps
    where t.page == p.name
    select t.*, p.*
    limit 1
  ]]
  plan = tostring(plan)
  -- `Output:` resolves wildcards against the child's resolved column list
  -- so the Project / Sort / Limit lines stay consistent with the join
  -- right below them. The user only sees `Result Columns:` carry the
  -- post-Design-A underscored Lua keys (the ordering may differ from
  -- `Output:` since wildcards are emitted per-source there).
  assertTrue(
    string.find(plan, "Output: t.page, t.tag, p.body, p.name", 1, true) ~= nil
      or string.find(plan, "Output: t.page, t.tag, p.name, p.body", 1, true)
        ~= nil,
    "152t: Output: must show resolved t.* / p.* columns"
  )
  for _, key in ipairs({ "t_page", "t_tag", "p_name", "p_body" }) do
    assertTrue(
      string.find(plan, key, 1, true) ~= nil,
      "152t: Result Columns must include " .. key
    )
  end
end

-- 152u. `select { *.* }` (or `select *`) on a multi-source join must NOT
-- leave a symbolic `*` cascading through Project / Sort / Limit while
-- the join below already shows the full column list. Every layer above
-- the join must agree on the resolved column list.
do
  local ts = { { page = "p1", tag = "x" } }
  local ps = { { name = "p1", body = "hi" } }
  local plan = query [[
    explain verbose
    from t = ts, p = ps
    where t.page == p.name
    select { *.* }
    limit 1
  ]]
  plan = tostring(plan)
  -- Pre-fix regression: any `Output: *` line indicates the cascade leaked
  -- a symbolic wildcard past the join. The Project (and everything above
  -- it) must mirror what the join itself reports.
  assertTrue(
    string.find(plan, "Output: *", 1, true) == nil,
    "152u: no Output: line should carry a bare `*` for a known-schema join"
  )
  -- Spot-check that the Project line reflects all four columns (in some
  -- per-source order); we don't pin a specific permutation since the
  -- planner chooses the join leaf order.
  for _, col in ipairs({ "t.page", "t.tag", "p.name", "p.body" }) do
    assertTrue(
      string.find(plan, col, 1, true) ~= nil,
      "152u: Output: must include " .. col
    )
  end
end

-- 152v0. Per-node timing invariant: every parent's `actual time=...total`
-- must be greater than or equal to its direct child's `actual time=...total`
do
  local ts = {
    { page = "p1", tag = "x" }, { page = "p2", tag = "y" },
    { page = "p3", tag = "x" }, { page = "p4", tag = "y" },
  }
  local ps = {
    { name = "p1", body = "a" }, { name = "p2", body = "b" },
    { name = "p3", body = "c" }, { name = "p4", body = "d" },
  }
  local plan = query [[
    explain analyze
    from t = ts, p = ps
    where t.page == p.name
    select *
    order by p.name
    limit 2
  ]]
  plan = tostring(plan)

  -- Walk the rendered plan and pull (indent, total_ms) for every line
  -- carrying an `actual time=...` annotation. Indent depth is in units
  -- of two spaces (the renderer's indentation step), with `->` markers
  -- accounted for. We then verify that whenever a child line follows a
  -- parent (deeper indent), the parent's total is >= the child's total.
  local entries = {}
  for line in string.gmatch(plan, "[^\n]+") do
    -- Each timing-bearing line looks like:
    --   "    ->  Sort  (cost=...) (actual time=START..TOTAL rows=N loops=1)"
    -- We capture the *total* (the second of the two dotted numbers).
    local total = string.match(line, "actual time=[%d%.]+%.%.([%d%.]+)")
    if total then
      -- Indent = leading whitespace before the optional `->`. The arrow
      -- itself counts as a level boundary, so `->  ` is "depth + 1".
      local prefix = string.match(line, "^( *)")
      local indent = #prefix
      if string.find(line, "->", 1, true) then
        -- `->  X` means X is one level below the previous header indent.
        indent = indent + 2
      end
      table.insert(entries, { indent = indent, total = tonumber(total), line = line })
    end
  end

  assertTrue(#entries >= 2, "152v0: plan must have multiple timed nodes")

  -- Walk through and check parent.total >= child.total for any
  -- (parent, child) pair where child immediately follows parent and
  -- has strictly greater indent.
  for i = 2, #entries do
    local prev = entries[i - 1]
    local cur = entries[i]
    if cur.indent > prev.indent then
      assertTrue(
        prev.total + 0.0005 >= cur.total,
        "152v0: parent.total (" .. prev.total
          .. ") must be >= child.total (" .. cur.total
          .. ")\nparent line: " .. prev.line
          .. "\nchild line: " .. cur.line
      )
    end
  end
end

-- 152v00. Single-source `explain analyze` must report per-node timing on
-- the leaf scan node. Pre-fix, the single-source path only set
-- actualRows/actualLoops on the scan and left actualTimeMs undefined,
-- so the scan rendered as `(actual rows=N loops=1)` with no `time=...`
-- block, breaking parent.total >= child.total at the scan boundary.
do
  local ts = { { name = "p1" }, { name = "p2" }, { name = "p3" } }
  local plan = query [[
    explain analyze
    from p = ts
    where p.name == "p2"
  ]]
  plan = tostring(plan)
  -- The leaf line for a single-source plan is whichever scan node sits
  -- at the bottom of the tree; we don't pin the exact label (may be
  -- `Function Seq Scan on p`, `Seq Scan on p`, or a JS-iterator scan).
  -- We just look for the line carrying the `on p` source-binding hint
  -- and require it to include an `actual time=X..Y` block.
  local scan_line = nil
  for line in string.gmatch(plan, "[^\n]+") do
    if
      string.find(line, " on p", 1, true)
      and string.find(line, "Scan", 1, true)
    then
      scan_line = line
      break
    end
  end
  assertTrue(
    scan_line ~= nil,
    "152v00: plan must contain a scan node bound to `p`; got: " .. plan
  )
  assertTrue(
    string.find(scan_line, "actual time=[%d%.]+%.%.[%d%.]+") ~= nil,
    "152v00: scan line must carry `actual time=...` after the fix; got: "
      .. scan_line
  )
end

-- 152v01. Implicit Project (no explicit `select`) is a passthrough -- it
-- exists in the plan tree so `Output:` can show the resolved column
-- list, but it does no per-row work, so the executor never opens a
-- "select" stage for it. Pre-fix, that left Project without timing or
-- row counts, breaking the parent.total >= child.total chain. Post-fix,
-- the renderer-level annotator inherits the child's actuals.
do
  local ts = { { tag = "x" }, { tag = "y" } }
  local plan = query [[
    explain analyze
    from t = ts
    group by t.tag
  ]]
  plan = tostring(plan)
  -- Walk the plan and find the Project line; it must carry an
  -- `actual time=...` annotation (inherited from the child) instead of
  -- a bare `(cost=...)`.
  local project_line = nil
  for line in string.gmatch(plan, "[^\n]+") do
    if string.find(line, "Project", 1, true) then
      project_line = line
      break
    end
  end
  assertTrue(project_line ~= nil, "152v01: plan must contain Project node")
  assertTrue(
    string.find(project_line, "actual time=[%d%.]+%.%.[%d%.]+") ~= nil,
    "152v01: implicit Project must inherit child timing; got: "
      .. project_line
  )
end

-- 152v. Non-grouped queries with both `select` and `order by` must stack
-- Project ABOVE Sort in the EXPLAIN tree. The executor evaluates the
-- pipeline as where -> orderBy -> select -> distinct -> limit, so Sort
-- must be the inner node and Project must wrap it.
do
  local ts = { { page = "p1" } }
  local plan = query [[
    explain
    from t = ts
    select { name = t.page }
    order by t.page
  ]]
  plan = tostring(plan)
  -- The textual plan indents children with `->`, so the Project line
  -- appears first (top-most) and `Sort` shows up as a child below it.
  local project_pos = string.find(plan, "Project", 1, true)
  local sort_pos = string.find(plan, "Sort", 1, true)
  assertTrue(
    project_pos ~= nil and sort_pos ~= nil,
    "152v: plan must contain both Project and Sort nodes"
  )
  assertTrue(
    project_pos < sort_pos,
    "152v: Project must appear ABOVE Sort in the EXPLAIN tree"
  )
end

-- 152w. Grouped queries (explicit GROUP BY or implicit aggregate) keep
-- the opposite stacking: Sort wraps Project, because grouping evaluates
-- the SELECT list inside the per-group loop BEFORE ORDER BY runs. This
-- is the inverse of 152v and intentionally so -- both shapes exist
-- because the executor uses different stage orders for the two cases.
do
  local ts = { { tag = "x" }, { tag = "x" }, { tag = "y" } }
  local plan = query [[
    explain
    from t = ts
    select { tag = t.tag, n = count() }
    group by t.tag
    order by t.tag
  ]]
  plan = tostring(plan)
  local project_pos = string.find(plan, "Project", 1, true)
  local sort_pos = string.find(plan, "Sort", 1, true)
  assertTrue(
    project_pos ~= nil and sort_pos ~= nil,
    "152w: plan must contain both Project and Sort nodes"
  )
  -- For grouped queries Sort sits ABOVE Project (sorts the projected
  -- per-group rows), so Sort prints first.
  assertTrue(
    sort_pos < project_pos,
    "152w: Sort must appear ABOVE Project for grouped queries"
  )
end

-- 153. Query-only `in` operator

-- 153a. where: basic `in` with bound field
do
  local r = query [[
    from
      p = pages
    where
      p.name in { "Alice", "Bob", "Greg" }
    select {
      name = p.name,
    }
    order by
      p.name
  ]]

  assertEquals(#r, 3)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Bob")
  assertEquals(r[3].name, "Greg")
end

-- 153b. where: basic `in` with unbound field
do
  local r = query [[
    from
      pages
    where
      name in { "Alice", "Carol" }
    select {
      name = name,
    }
    order by
      name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Carol")
end

-- 153c. where: numeric `in`
do
  local r = query [[
    from
      p = pages
    where
      p.size in { 1, 3, 20 }
    select {
      name = p.name,
      size = p.size,
    }
    order by
      p.size
  ]]

  assertEquals(#r, 3)
  assertEquals(r[1].name, "Fran")
  assertEquals(r[1].size, 1)
  assertEquals(r[2].name, "Ed")
  assertEquals(r[2].size, 3)
  assertEquals(r[3].name, "Bob")
  assertEquals(r[3].size, 20)
end

-- 153d. where: boolean `in`
do
  local data = {
    { name = "a", ok = true },
    { name = "b", ok = false },
    { name = "c", ok = true },
  }

  local r = query [[
    from
      p = data
    where
      p.ok in { true }
    select {
      name = p.name,
    }
    order by
      p.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "a")
  assertEquals(r[2].name, "c")
end

-- 153e. where: `not ... in`
do
  local r = query [[
    from
      p = pages
    where
      not p.name in { "Alice", "Bob", "Greg" }
    select {
      name = p.name,
    }
    order by
      p.name
  ]]

  assertEquals(#r, 4)
  assertEquals(r[1].name, "Carol")
  assertEquals(r[2].name, "Dave")
  assertEquals(r[3].name, "Ed")
  assertEquals(r[4].name, "Fran")
end

-- 153f. where: `in {}` always false
do
  local r = query [[
    from
      p = pages
    where
      p.name in {}
    select {
      name = p.name,
    }
  ]]

  assertEquals(#r, 0)
end

-- 153g. where: `not ... in {}` always true
do
  local r = query [[
    from
      p = pages
    where
      not p.name in {}
    select {
      name = p.name,
    }
  ]]

  assertEquals(#r, #pages)
end

-- 153h. where: duplicates in RHS table do not matter
do
  local r = query [[
    from
      p = pages
    where
      p.name in { "Bob", "Bob", "Alice", "Bob" }
    select {
      name = p.name,
    }
    order by
      p.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Bob")
end

-- 153i. where: `{ nil }` behaves like an empty RHS under Lua table semantics
do
  local r = query [[
    from
      p = pages
    where
      p.tags[3] in { nil }
    select {
      name = p.name,
    }
  ]]

  assertEquals(#r, 0)
end

-- 153j. where: `{ nil }` behaves like an empty RHS under Lua table semantics
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] in { nil }
    select {
      name = p.name,
    }
    order by
      p.name
  ]]

  assertEquals(#r, 0)
end

-- 153k. where: nil mixed with other values in RHS
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] in { nil, "work" }
    select {
      name = p.name,
    }
    order by
      p.name
  ]]

  -- Alice, Bob, Greg have "work"; Ed has nil
  assertEquals(#r, 4)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Bob")
  assertEquals(r[3].name, "Ed")
  assertEquals(r[4].name, "Greg")
end

-- 153l. where: RHS may be a variable holding a table
do
  local allowed = { "Alice", "Fran" }

  local r = query [[
    from
      p = pages
    where
      p.name in allowed
    select {
      name = p.name,
    }
    order by
      p.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Fran")
end

-- 153m. where: RHS may be an expression producing a table
do
  local r = query [[
    from
      p = pages
    where
      p.name in { "Alice", "Bob" .. "" }
    select {
      name = p.name,
    }
    order by
      p.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Bob")
end

-- 153n. where: `in` works on projected query values
do
  local r = query [[
    from
      p = pages
    where
      p.size in { 5, 10, 15 }
    select {
      name = p.name,
      size = p.size,
    }
    order by
      p.size
  ]]

  assertEquals(#r, 3)
  assertEquals(r[1].name, "Carol")
  assertEquals(r[2].name, "Alice")
  assertEquals(r[3].name, "Dave")
end

-- 153o. where: error when RHS is nil
do
  local ok, err = pcall(function()
    local nothing = nil
    local _r = query [[
      from
        p = pages
      where
        p.name in nothing
      select {
        name = p.name,
      }
    ]]
  end)

  assertEquals(ok, false)
  assertTrue(
    string.find(tostring(err), "'in' requires a table or array on the right side")
      ~= nil,
    "expected rhs nil error, got: " .. tostring(err)
  )
end

-- 153p. where: error when RHS is non-table scalar
do
  local ok, err = pcall(function()
    local _r = query [[
      from
        p = pages
      where
        p.name in 123
      select {
        name = p.name,
      }
    ]]
  end)

  assertEquals(ok, false)
  assertTrue(
    string.find(tostring(err), "'in' requires a table or array on the right side")
      ~= nil,
    "expected rhs scalar error, got: " .. tostring(err)
  )
end

-- 153q. having: basic `in` without group by
do
  local r = query [[
    from
      p = pages
    having
      p.name in { "Alice", "Ed" }
    select {
      name = p.name,
    }
    order by
      p.name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Ed")
end

-- 153r. having: `not ... in` without group by
do
  local r = query [[
    from
      p = pages
    having
      not p.name in { "Alice", "Ed" }
    select {
      name = p.name,
    }
    order by
      p.name
  ]]

  assertEquals(#r, 5)
  assertEquals(r[1].name, "Bob")
  assertEquals(r[2].name, "Carol")
  assertEquals(r[3].name, "Dave")
  assertEquals(r[4].name, "Fran")
  assertEquals(r[5].name, "Greg")
end

-- 153s. having: grouped query using key in { ... }
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    having
      key in { "work", "random" }
    select {
      tag = key,
      n = count(),
    }
    order by
      tag
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].tag, "random")
  assertEquals(r[1].n, 1)
  assertEquals(r[2].tag, "work")
  assertEquals(r[2].n, 3)
end

-- 153t. having: grouped query with `not key in { ... }`
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    having
      not key in { "work", "random" }
    select {
      tag = key,
      n = count(),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].tag, "personal")
  assertEquals(r[1].n, 2)
end

-- 153u. having: grouped query with aggregate result in { ... }
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    having
      count() in { 1, 3 }
    select {
      tag = key,
      n = count(),
    }
    order by
      tag
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].tag, "random")
  assertEquals(r[1].n, 1)
  assertEquals(r[2].tag, "work")
  assertEquals(r[2].n, 3)
end

-- 153v. having: grouped query with `#group in { ... }`
do
  local r = query [[
    from
      p = pages
    where
      p.tags[1] ~= nil
    group by
      p.tags[1]
    having
      #group in { 2, 3 }
    select {
      tag = key,
      n = #group,
    }
    order by
      tag
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].tag, "personal")
  assertEquals(r[1].n, 2)
  assertEquals(r[2].tag, "work")
  assertEquals(r[2].n, 3)
end

-- 153w. select: `in` in projected expression, bound
do
  local r = query [[
    from
      p = pages
    select {
      name = p.name,
      hit = p.name in { "Alice", "Bob" },
    }
    order by
      p.name
  ]]

  assertEquals(#r, 7)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[1].hit, true)
  assertEquals(r[2].name, "Bob")
  assertEquals(r[2].hit, true)
  assertEquals(r[3].name, "Carol")
  assertEquals(r[3].hit, false)
end

-- 153x. select: `not ... in` in projected expression, unbound
do
  local r = query [[
    from
      pages
    select {
      name = name,
      miss = not name in { "Alice", "Bob" },
    }
    order by
      name
  ]]

  assertEquals(#r, 7)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[1].miss, false)
  assertEquals(r[2].name, "Bob")
  assertEquals(r[2].miss, false)
  assertEquals(r[3].name, "Carol")
  assertEquals(r[3].miss, true)
end

-- 153y. select: scalar projection using `in`
do
  local r = query [[
    from
      p = pages
    select all
      p.name in { "Alice", "Greg" }
    order by
      p.name
  ]]

  assertEquals(#r, 7)
  assertEquals(r[1], true)
  assertEquals(r[2], false)
  assertEquals(r[3], false)
  assertEquals(r[4], false)
  assertEquals(r[5], false)
  assertEquals(r[6], false)
  assertEquals(r[7], true)
end

-- 153z. group by: grouping on boolean result of `in`
do
  local r = query [[
    from
      p = pages
    group by
      p.name in { "Alice", "Bob" }
    select {
      k = key,
      n = count(),
    }
    order by
      k desc
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].k, true)
  assertEquals(r[1].n, 2)
  assertEquals(r[2].k, false)
  assertEquals(r[2].n, 5)
end

-- 153aa. order by: boolean expression using `in`
do
  local r = query [[
    from
      p = pages
    select {
      name = p.name,
    }
    order by
      p.name in { "Alice", "Bob" } desc,
      p.name
  ]]

  assertEquals(#r, 7)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Bob")
  assertEquals(r[3].name, "Carol")
end

-- 153ab. order by: projected key expression using `in`
do
  local r = query [[
    from
      p = pages
    select {
      name = p.name,
      hit = p.name in { "Alice", "Bob" },
    }
    order by
      hit desc, name
  ]]

  assertEquals(#r, 7)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[1].hit, true)
  assertEquals(r[2].name, "Bob")
  assertEquals(r[2].hit, true)
  assertEquals(r[3].name, "Carol")
  assertEquals(r[3].hit, false)
end

-- 153ac. aggregate filter(where ...): `in` on bound field
do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      picked = count() filter(where p.name in { "Alice", "Bob", "Greg" }),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].picked, 3)
end

-- 153ad. aggregate filter(where ...): `not ... in` on bound field
do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      skipped = count() filter(where not p.name in { "Alice", "Bob", "Greg" }),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].skipped, 4)
end

-- 153ae. aggregate filter(where ...): `in` on unbound field
do
  local r = query [[
    from
      pages
    group by
      "all"
    select {
      picked = count() filter(where name in { "Alice", "Ed" }),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].picked, 2)
end

-- 153af. multi-source where: `in` on one source alongside join predicate
do
  local depts = {
    { dept = "eng" },
    { dept = "sales" },
    { dept = "hr" },
  }
  local employees = {
    { name = "Alice", dept = "eng" },
    { name = "Bob", dept = "eng" },
    { name = "Carol", dept = "sales" },
    { name = "Eve", dept = "hr" },
  }

  local r = query [[
    from
      d = depts,
      e = employees
    where
      d.dept == e.dept and e.name in { "Alice", "Carol" }
    select {
      dept = d.dept,
      name = e.name,
    }
    order by
      dept, name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].dept, "sales")
  assertEquals(r[2].name, "Carol")
end

-- 153ag. multi-source where: `not ... in` on one source alongside join predicate
do
  local depts = {
    { dept = "eng" },
    { dept = "sales" },
    { dept = "hr" },
  }
  local employees = {
    { name = "Alice", dept = "eng" },
    { name = "Bob", dept = "eng" },
    { name = "Carol", dept = "sales" },
    { name = "Eve", dept = "hr" },
  }

  local r = query [[
    from
      d = depts,
      e = employees
    where
      d.dept == e.dept and not e.name in { "Alice", "Carol" }
    select {
      dept = d.dept,
      name = e.name,
    }
    order by
      dept, name
  ]]

  assertEquals(#r, 2)
  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].name, "Bob")
  assertEquals(r[2].dept, "hr")
  assertEquals(r[2].name, "Eve")
end

-- 153ah. aggregate order by: `in` expression as sort key
do
  local data = {
    { grp = "x", name = "Greg" },
    { grp = "x", name = "Alice" },
    { grp = "x", name = "Bob" },
    { grp = "x", name = "Carol" },
  }

  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(
        p.name
        order by p.name in { "Alice", "Bob" } desc, p.name asc
      ),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].names[1], "Alice")
  assertEquals(r[1].names[2], "Bob")
  assertEquals(r[1].names[3], "Carol")
  assertEquals(r[1].names[4], "Greg")
end

-- 153ai. aggregate order by: `not ... in` expression as sort key
do
  local data = {
    { grp = "x", name = "Greg" },
    { grp = "x", name = "Alice" },
    { grp = "x", name = "Bob" },
    { grp = "x", name = "Carol" },
  }

  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(
        p.name
        order by not p.name in { "Alice", "Bob" } desc, p.name asc
      ),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].names[1], "Carol")
  assertEquals(r[1].names[2], "Greg")
  assertEquals(r[1].names[3], "Alice")
  assertEquals(r[1].names[4], "Bob")
end

-- 153aj. aggregate order by: unbound `in` expression as sort key
do
  local data = {
    { grp = "x", name = "Greg" },
    { grp = "x", name = "Alice" },
    { grp = "x", name = "Bob" },
    { grp = "x", name = "Carol" },
  }

  local r = query [[
    from
      data
    group by
      grp
    select {
      names = array_agg(
        name
        order by name in { "Alice", "Bob" } desc, name asc
      ),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].names[1], "Alice")
  assertEquals(r[1].names[2], "Bob")
  assertEquals(r[1].names[3], "Carol")
  assertEquals(r[1].names[4], "Greg")
end

-- 153ak. aggregate order by + filter(where ... in ...)
do
  local data = {
    { grp = "x", name = "Greg", keep = false },
    { grp = "x", name = "Alice", keep = true },
    { grp = "x", name = "Bob", keep = true },
    { grp = "x", name = "Carol", keep = false },
  }

  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(
        p.name
        order by p.name in { "Alice", "Bob" } desc, p.name asc
      ) filter(where p.name in { "Alice", "Bob", "Carol" }),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].names[1], "Alice")
  assertEquals(r[1].names[2], "Bob")
  assertEquals(r[1].names[3], "Carol")
end

-- 153al. aggregate order by: `in {}` yields all false and falls back to next key
do
  local data = {
    { grp = "x", name = "Greg" },
    { grp = "x", name = "Alice" },
    { grp = "x", name = "Bob" },
  }

  local r = query [[
    from
      p = data
    group by
      p.grp
    select {
      names = array_agg(
        p.name
        order by p.name in {} desc, p.name asc
      ),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].names[1], "Alice")
  assertEquals(r[1].names[2], "Bob")
  assertEquals(r[1].names[3], "Greg")
end

-- 153am. having: error when RHS is nil
do
  local ok, err = pcall(function()
    local nothing = nil
    local _r = query [[
      from
        p = pages
      group by
        "all"
      having
        count() in nothing
      select {
        n = count(),
      }
    ]]
  end)

  assertEquals(ok, false)
  assertTrue(
    string.find(tostring(err), "'in' requires a table or array on the right side")
      ~= nil,
    "expected having rhs nil error, got: " .. tostring(err)
  )
end

-- 153z. aggregate filter: `in` inside filter(where ...)

-- 153z1. count with filter(where ... in ...)
do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      picked = count() filter(where p.name in { "Alice", "Greg", "Ed" }),
      skipped = count() filter(where not p.name in { "Alice", "Greg", "Ed" }),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(r[1].picked, 3)
  assertEquals(r[1].skipped, 4)
end

-- 153z2. array_agg with filter(where ... in ...)
do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      names = array_agg(p.name order by p.name asc)
        filter(where p.tags[1] in { "work", "random" }),
    }
  ]]

  assertEquals(#r, 1)
  assertEquals(#r[1].names, 4)
  assertEquals(r[1].names[1], "Alice")
  assertEquals(r[1].names[2], "Bob")
  assertEquals(r[1].names[3], "Fran")
  assertEquals(r[1].names[4], "Greg")
end

-- 154. aggregate order by: `in` inside aggregate order-by expression

-- 154a. array_agg ordered by boolean `in` expression desc
do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      names = array_agg(
        p.name
        order by p.name in { "Alice", "Greg" } desc, p.name asc
      ),
    }
  ]]

  assertEquals(#r, 1)
  -- true first, then false; tie-break by name asc
  assertEquals(r[1].names[1], "Alice")
  assertEquals(r[1].names[2], "Greg")
  assertEquals(r[1].names[3], "Bob")
  assertEquals(r[1].names[4], "Carol")
  assertEquals(r[1].names[5], "Dave")
  assertEquals(r[1].names[6], "Ed")
  assertEquals(r[1].names[7], "Fran")
end

-- 154b. array_agg ordered by `not ... in ...` desc
do
  local r = query [[
    from
      p = pages
    group by
      "all"
    select {
      names = array_agg(
        p.name
        order by not p.name in { "Alice", "Greg" } desc, p.name asc
      ),
    }
  ]]

  assertEquals(#r, 1)
  -- names not in set first, then the listed names
  assertEquals(r[1].names[1], "Bob")
  assertEquals(r[1].names[2], "Carol")
  assertEquals(r[1].names[3], "Dave")
  assertEquals(r[1].names[4], "Ed")
  assertEquals(r[1].names[5], "Fran")
  assertEquals(r[1].names[6], "Alice")
  assertEquals(r[1].names[7], "Greg")
end

-- 200. Wildcard projection (`*`, `source.*`, `*.<column>`)
--
-- SLIQ adopts Postgres' star semantics.  Semantics summary:
--
-- - `*`:     all columns from all sources, flattened.
-- - `src.*`: all columns of the named source; errors if src not in FROM.
-- - `*.col`: the column `col` from every source; in multi-source queries
--            keys are prefixed with the source name (`p_col`, `t_col`).
local function keyCount(tbl)
  local n = 0
  for _ in pairs(tbl) do n = n + 1 end
  return n
end

local function hasKey(tbl, key)
  for k in pairs(tbl) do
    if k == key then return true end
  end
  return false
end

-- 200a. `SELECT *` on unaliased single source expands to all row columns.
do
  local r = query [[
    from pages
    select *
  ]]
  assertEquals(#r, #pages)
  -- Every row should carry exactly the source's columns (name, tags, size, age)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[1].size, 10)
  assertEquals(r[1].age, 31)
  assertTrue(type(r[1].tags) == "table")
end

-- 200b. `SELECT *` on aliased single source.
do
  local r = query [[
    from p = pages
    select *
  ]]
  assertEquals(#r, #pages)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[1].size, 10)
end

-- 200c. `SELECT *.*` is equivalent to `SELECT *`.
do
  local r1 = query [[ from pages select *   ]]
  local r2 = query [[ from pages select *.* ]]
  assertEquals(#r1, #r2)
  for i = 1, #r1 do
    assertEquals(r1[i].name, r2[i].name)
    assertEquals(r1[i].size, r2[i].size)
  end
end

-- 200d. `SELECT src.*` on aliased single source.
do
  local r = query [[
    from p = pages
    select p.*
  ]]
  assertEquals(#r, #pages)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[1].age, 31)
end

-- 200e. `SELECT src.*` with a non-matching source name errors.
do
  local ok, err = pcall(function()
    local _ = query [[
      from p = pages
      select t.*
    ]]
  end)
  assertTrue(not ok, "200e: expected error for unknown source 't'")
  assertTrue(
    err
      and string.find(tostring(err), 'missing \'from\' clause entry for table "t"'),
    "200e: error should mention missing FROM entry for t"
  )
end

-- 200e2. `SELECT _.*` on an unaliased single source expands like `SELECT *`.
do
  local rStar = query [[ from pages select *   ]]
  local rUnderscoreStar = query [[ from pages select _.* ]]
  assertEquals(#rStar, #rUnderscoreStar)
  for i = 1, #rStar do
    assertEquals(rStar[i].name, rUnderscoreStar[i].name)
    assertEquals(rStar[i].size, rUnderscoreStar[i].size)
    assertEquals(rStar[i].age, rUnderscoreStar[i].age)
  end
end

-- 200e3. Mixing `_.col` and `_.*` in the same select list works the same as
-- mixing the bare column with `*`.
do
  local r = query [[
    from pages
    select _.*, doubled = _.size * 2
    order by _.name
  ]]
  assertEquals(#r, #pages)
  assertTrue(hasKey(r[1], "name"))
  assertTrue(hasKey(r[1], "size"))
  assertTrue(hasKey(r[1], "doubled"))
  assertEquals(r[1].doubled, r[1].size * 2)
end

-- 200f. `SELECT *, extra` overlays a computed column onto the wildcard
-- (bare-list form, matching Postgres `SELECT *, col AS extra FROM t`).
do
  local r = query [[
    from p = pages
    select *, doubled = p.size * 2
  ]]
  assertEquals(#r, #pages)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[1].doubled, 20)
end

-- 200g. `SELECT *.<col>` on single source keeps the bare column name.
do
  local r = query [[
    from pages
    select *.name
  ]]
  assertEquals(#r, #pages)
  assertEquals(r[1].name, "Alice")
  assertEquals(r[2].name, "Bob")
end

-- 200h. Multi-source `SELECT *` flattens columns from every source and
-- qualifies each key with `<source>_`, so collisions across sources can't
-- silently drop data.
do
  local xs = { { x = 1, shared = "left" }, { x = 2, shared = "left" } }
  local ys = { { y = 10 }, { y = 20 } }
  local r = query [[
    from a = xs, b = ys
    select *
    order by a.x, b.y
  ]]
  assertEquals(#r, 4, "200h: cross-join row count")
  assertEquals(r[1].a_x, 1)
  assertEquals(r[1].b_y, 10)
  -- `shared` is from `a`, surfaced as `a_shared`.
  assertEquals(r[1].a_shared, "left")
end

-- 200i. Multi-source `SELECT a.*` returns only `a`'s columns, qualified.
-- Use `select all` so we see one row per cross-join pair (SLIQ defaults to
-- DISTINCT, Postgres defaults to ALL; we mirror the row count of Postgres
-- here by being explicit).
do
  local xs = { { x = 1 } }
  local ys = { { y = 10, y2 = 100 }, { y = 20, y2 = 200 } }
  local r = query [[
    from a = xs, b = ys
    select all a.*
    order by a.x, b.y
  ]]
  assertEquals(#r, 2, "200i: row count (1 * 2)")
  assertEquals(r[1].a_x, 1)
  assertEquals(r[2].a_x, 1)
  assertTrue(not hasKey(r[1], "b_y"), "200i: b_y should not be in projection")
  assertTrue(not hasKey(r[1], "b_y2"), "200i: b_y2 should not be in projection")
  assertTrue(not hasKey(r[1], "y"), "200i: y should not be in projection")
end

-- 200j. Multi-source `SELECT *.col` prefixes keys with source names.
do
  local xs = { { val = 1 }, { val = 2 } }
  local ys = { { val = 10 } }
  local r = query [[
    from a = xs, b = ys
    select *.val
    order by a.val, b.val
  ]]
  assertEquals(#r, 2, "200j: row count")
  assertEquals(r[1].a_val, 1, "200j: a_val")
  assertEquals(r[1].b_val, 10, "200j: b_val")
  assertEquals(r[2].a_val, 2, "200j: a_val second row")
  assertEquals(r[2].b_val, 10, "200j: b_val second row")
end

-- 200k. Multi-source `SELECT a.*, b.*` keeps both sides intact and
-- qualifies their column keys (bare-list form, matching Postgres
-- `SELECT a.*, b.* FROM a, b` semantics, with SLIQ's `<source>_<col>`
-- naming so that overlaps don't collide).
do
  local xs = { { x = 1 } }
  local ys = { { y = 10 }, { y = 20 } }
  local r = query [[
    from a = xs, b = ys
    select a.*, b.*
    order by a.x, b.y
  ]]
  assertEquals(#r, 2, "200k: row count")
  assertEquals(r[1].a_x, 1)
  assertEquals(r[1].b_y, 10)
  assertEquals(r[2].b_y, 20)
end

-- 200l. Wildcards inside `select { ... }` brace form (parity with bare list).
-- The brace and bare forms should produce identical projections.
do
  local r1 = query [[ from p = pages select   p.*   ]]
  local r2 = query [[ from p = pages select { p.* } ]]
  assertEquals(#r1, #r2)
  for i = 1, #r1 do
    assertEquals(r1[i].name, r2[i].name)
    assertEquals(r1[i].size, r2[i].size)
    assertEquals(r1[i].age, r2[i].age)
  end
end

do
  local r1 = query [[ from pages select   *   ]]
  local r2 = query [[ from pages select { * } ]]
  assertEquals(#r1, #r2)
  for i = 1, #r1 do
    assertEquals(r1[i].name, r2[i].name)
  end
end

do
  local r1 = query [[ from pages select   *.name   ]]
  local r2 = query [[ from pages select { *.name } ]]
  assertEquals(#r1, #r2)
  for i = 1, #r1 do
    assertEquals(r1[i].name, r2[i].name)
  end
end

do
  local r1 = query [[
    from p = pages
    select all p.*, doubled = p.size * 2
    order by p.name
  ]]
  local r2 = query [[
    from p = pages
    select all { p.*, doubled = p.size * 2 }
    order by p.name
  ]]
  assertEquals(#r1, #r2)
  for i = 1, #r1 do
    assertEquals(r1[i].name, r2[i].name)
    assertEquals(r1[i].doubled, r2[i].doubled)
  end
end

-- 200m. Multi-source `select { *.* }` mirrors `select *.*`.
do
  local xs = { { val = 1 }, { val = 2 } }
  local ys = { { val = 10 } }
  local r1 = query [[
    from a = xs, b = ys
    select   *.*
    order by a.val, b.val
  ]]
  local r2 = query [[
    from a = xs, b = ys
    select { *.* }
    order by a.val, b.val
  ]]
  assertEquals(#r1, #r2)
  for i = 1, #r1 do
    assertEquals(r1[i].a_val, r2[i].a_val)
    assertEquals(r1[i].b_val, r2[i].b_val)
  end
end

-- 201. GROUP BY wildcard expansion

-- 201a. `GROUP BY *` groups by every row column (single source).
do
  local data = {
    { cat = "a", val = 1 },
    { cat = "a", val = 1 },
    { cat = "b", val = 2 },
    { cat = "a", val = 1 },
  }
  local r = query [[
    from p = data
    group by *
    select { cat = p.cat, val = p.val, n = count(*) }
    order by p.cat, p.val
  ]]
  assertEquals(#r, 2, "201a: group count")
  assertEquals(r[1].cat, "a")
  assertEquals(r[1].val, 1)
  assertEquals(r[1].n, 3, "201a: group a has 3 rows")
  assertEquals(r[2].cat, "b")
  assertEquals(r[2].val, 2)
  assertEquals(r[2].n, 1, "201a: group b has 1 row")
end

-- 201b. `GROUP BY src.*` groups by every column of a named source.
do
  local ps = {
    { dept = "eng", level = 1 },
    { dept = "eng", level = 1 },
    { dept = "eng", level = 2 },
    { dept = "sales", level = 1 },
  }
  local ts = { { tag = "x" }, { tag = "y" } }
  local r = query [[
    from p = ps, t = ts
    group by p.*
    select { dept = p.dept, level = p.level, n = count(*) }
    order by p.dept, p.level
  ]]
  assertEquals(#r, 3, "201b: distinct (dept, level) groups")
  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].level, 1)
  assertEquals(r[1].n, 4, "201b: 2 p-rows * 2 t-rows")
  assertEquals(r[2].dept, "eng")
  assertEquals(r[2].level, 2)
  assertEquals(r[2].n, 2)
  assertEquals(r[3].dept, "sales")
  assertEquals(r[3].n, 2)
end

-- 201c. `GROUP BY *.col` is rejected at parse time (ambiguous semantics).
do
  local ok, err = pcall(function()
    local _ = query [[
      from pages
      group by *.name
      select { n = count(*) }
    ]]
  end)
  assertTrue(not ok, "201c: expected parse error for '*.col' in group by")
  assertTrue(
    err and string.find(tostring(err):lower(), "group by"),
    "201c: error should mention 'group by'"
  )
end

-- 201d. `GROUP BY src.*` with unknown source name fails at runtime.
do
  local ok, err = pcall(function()
    local _ = query [[
      from p = pages
      group by q.*
      select { n = count(*) }
    ]]
  end)
  assertTrue(not ok, "201d: expected error for unknown source 'q'")
  assertTrue(
    err
      and string.find(tostring(err), 'missing \'from\' clause entry for table "q"'),
    "201d: error should mention missing FROM entry for q"
  )
end

-- 201e. `group by { ... }` brace form is parity with bare list.
do
  local ps = {
    { dept = "eng", level = 1 },
    { dept = "eng", level = 1 },
    { dept = "eng", level = 2 },
    { dept = "sales", level = 1 },
  }
  local r1 = query [[
    from p = ps
    group by   p.*
    select { dept = p.dept, level = p.level, n = count(*) }
    order by p.dept, p.level
  ]]
  local r2 = query [[
    from p = ps
    group by { p.* }
    select { dept = p.dept, level = p.level, n = count(p.*) }
    order by p.dept, p.level
  ]]
  assertEquals(#r1, #r2)
  for i = 1, #r1 do
    assertEquals(r1[i].dept, r2[i].dept)
    assertEquals(r1[i].level, r2[i].level)
    assertEquals(r1[i].n, r2[i].n)
  end
end

-- 202. ORDER BY wildcard expansion

-- 202a. `ORDER BY *` sorts by every column alphabetically (single source).
do
  local data = {
    { a = 2, b = 20 },
    { a = 1, b = 30 },
    { a = 1, b = 10 },
    { a = 2, b = 10 },
  }
  local r = query [[
    from p = data
    select all p
    order by *
  ]]
  assertEquals(#r, 4)
  -- Column order is sorted: a, b.  So we get (1,10), (1,30), (2,10), (2,20).
  assertEquals(r[1].a, 1); assertEquals(r[1].b, 10)
  assertEquals(r[2].a, 1); assertEquals(r[2].b, 30)
  assertEquals(r[3].a, 2); assertEquals(r[3].b, 10)
  assertEquals(r[4].a, 2); assertEquals(r[4].b, 20)
end

-- 202b. `ORDER BY *` with DESC sorts every column descending.
do
  local data = {
    { a = 2, b = 20 },
    { a = 1, b = 30 },
    { a = 1, b = 10 },
    { a = 2, b = 10 },
  }
  local r = query [[
    from p = data
    select all p
    order by * desc
  ]]
  assertEquals(#r, 4)
  -- Desc on both (a, b): (2,20), (2,10), (1,30), (1,10).
  assertEquals(r[1].a, 2); assertEquals(r[1].b, 20)
  assertEquals(r[2].a, 2); assertEquals(r[2].b, 10)
  assertEquals(r[3].a, 1); assertEquals(r[3].b, 30)
  assertEquals(r[4].a, 1); assertEquals(r[4].b, 10)
end

-- 202c. `ORDER BY src.*` sorts by every column of the given source.
do
  local xs = { { x = 2 }, { x = 1 } }
  local ys = { { y = 2 }, { y = 1 } }
  local r = query [[
    from a = xs, b = ys
    select all { ax = a.x, by = b.y }
    order by a.*
  ]]
  assertEquals(#r, 4)
  assertEquals(r[1].ax, 1); assertEquals(r[2].ax, 1)
  assertEquals(r[3].ax, 2); assertEquals(r[4].ax, 2)
end

-- 202d. `ORDER BY *.<col>` with multi-source sorts by that column per source.
do
  local xs = { { v = 1 }, { v = 3 } }
  local ys = { { v = 2 }, { v = 1 } }
  local r = query [[
    from a = xs, b = ys
    select all { av = a.v, bv = b.v }
    order by *.v
  ]]
  assertEquals(#r, 4)
  -- Sort prefers a.v asc, then b.v asc.
  -- Cross-join rows: (1,2), (1,1), (3,2), (3,1).
  -- After sort: (1,1), (1,2), (3,1), (3,2).
  assertEquals(r[1].av, 1); assertEquals(r[1].bv, 1)
  assertEquals(r[2].av, 1); assertEquals(r[2].bv, 2)
  assertEquals(r[3].av, 3); assertEquals(r[3].bv, 1)
  assertEquals(r[4].av, 3); assertEquals(r[4].bv, 2)
end

-- 202e. `ORDER BY *.<col>` on single source sorts by that bare column.
do
  local data = { { v = 3, label = "c" }, { v = 1, label = "a" }, { v = 2, label = "b" } }
  local r = query [[
    from p = data
    select all p.label
    order by *.v
  ]]
  assertEquals(#r, 3)
  -- Single scalar projection: each row is the string directly.
  assertEquals(r[1], "a")
  assertEquals(r[2], "b")
  assertEquals(r[3], "c")
end

-- 202f. `ORDER BY t.* desc, u.name` mixes wildcard and regular sort keys.
do
  local xs = { { id = 2, extra = "x" }, { id = 1, extra = "y" } }
  local ys = { { name = "b" }, { name = "a" } }
  local r = query [[
    from t = xs, u = ys
    select all { id = t.id, extra = t.extra, name = u.name }
    order by t.* desc, u.name
  ]]
  assertEquals(#r, 4)
  -- t.* sorted desc (by extra, id alphabetically => 'y',1 then 'x',2).
  -- Order of sort keys: t.extra desc, t.id desc, u.name asc.
  -- Rows: t=(2,"x"),u="b"; t=(2,"x"),u="a"; t=(1,"y"),u="b"; t=(1,"y"),u="a".
  -- Desc on extra: "y" > "x", so "y" first.
  -- With extra="y", id=1 (only one). Then u.name asc: a, b.
  -- With extra="x", id=2 (only one). Then u.name asc: a, b.
  assertEquals(r[1].extra, "y"); assertEquals(r[1].id, 1); assertEquals(r[1].name, "a")
  assertEquals(r[2].extra, "y"); assertEquals(r[2].id, 1); assertEquals(r[2].name, "b")
  assertEquals(r[3].extra, "x"); assertEquals(r[3].id, 2); assertEquals(r[3].name, "a")
  assertEquals(r[4].extra, "x"); assertEquals(r[4].id, 2); assertEquals(r[4].name, "b")
end

-- 202g. `ORDER BY src.*` with unknown source raises a runtime error.
do
  local ok, err = pcall(function()
    local _ = query [[
      from pages
      order by q.*
    ]]
  end)
  assertTrue(not ok, "202g: expected error for unknown source 'q'")
  assertTrue(
    err
      and string.find(tostring(err), 'missing \'from\' clause entry for table "q"'),
    "202g: error should mention missing FROM entry for q"
  )
end

-- 203. Aggregate wildcard arguments

-- 203a. `count(*)` counts every row (same as bare `count()`).
do
  local data = { { a = 1 }, { a = 2 }, { a = 3 } }
  local r = query [[
    from d = data
    select all { n = count(*) }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].n, 3)
end

-- 203b. `count(*.*)` is an alias for `count(*)`.
do
  local data = { { a = 1 }, { a = 2 }, { a = 3 } }
  local r = query [[
    from d = data
    select all { n = count(*.*) }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].n, 3)
end

-- 203c. `count(<source>.*)` counts every row of that source (single-source).
do
  local data = { { a = 1 }, { a = 2 }, { a = 3 } }
  local r = query [[
    from d = data
    select all { n = count(d.*) }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].n, 3)
end

-- 203d. Multi-source `count(*)` counts rows of the cross join.
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = 1 }, { y = 2 }, { y = 3 } }
  local r = query [[
    from a = xs, b = ys
    select all { n = count(*) }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].n, 6)
end

-- 203e. Multi-source `count(<source>.*)` counts joined rows of that source.
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = 1 }, { y = 2 }, { y = 3 } }
  local r = query [[
    from a = xs, b = ys
    select all { n = count(a.*) }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].n, 6)
end

-- 203f. `count(*) filter (where ...)` counts rows passing the filter.
do
  local data = { { v = 1 }, { v = 2 }, { v = 3 }, { v = 4 } }
  local r = query [[
    from d = data
    select all { n = count(*) filter (where d.v >= 3) }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].n, 2)
end

-- 203g. `count(<source>.*) filter (where ...)` combines source wildcard and filter.
do
  local data = { { v = 1 }, { v = 2 }, { v = 3 }, { v = 4 } }
  local r = query [[
    from d = data
    select all { n = count(d.*) filter (where d.v >= 3) }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].n, 2)
end

-- 203h. `count(*)` with GROUP BY produces per-group counts.
do
  local data = {
    { g = "a", v = 1 },
    { g = "a", v = 2 },
    { g = "b", v = 3 },
    { g = "c", v = 4 },
  }
  local r = query [[
    from d = data
    group by d.g
    select all { g = d.g, n = count(*) }
    order by d.g
  ]]
  assertEquals(#r, 3)
  assertEquals(r[1].g, "a"); assertEquals(r[1].n, 2)
  assertEquals(r[2].g, "b"); assertEquals(r[2].n, 1)
  assertEquals(r[3].g, "c"); assertEquals(r[3].n, 1)
end

-- 203i. `count(*) filter (where ...)` with GROUP BY filters per group.
do
  local data = {
    { g = "a", v = 1 },
    { g = "a", v = 2 },
    { g = "b", v = 3 },
    { g = "c", v = 4 },
  }
  local r = query [[
    from d = data
    group by d.g
    select all { g = d.g, n = count(*) filter (where d.v >= 2) }
    order by d.g
  ]]
  assertEquals(#r, 3)
  assertEquals(r[1].g, "a"); assertEquals(r[1].n, 1)
  assertEquals(r[2].g, "b"); assertEquals(r[2].n, 1)
  assertEquals(r[3].g, "c"); assertEquals(r[3].n, 1)
end

-- 203j. Non-aggregate functions reject wildcard arguments.
do
  local ok, err = pcall(function()
    local _ = query [[
      from p = pages
      select all { n = math.abs(*) }
    ]]
  end)
  assertTrue(not ok, "203j: expected error for wildcard on non-aggregate")
  assertTrue(
    err and string.find(tostring(err), "not an aggregate function"),
    "203j: error should report non-aggregate call"
  )
end

-- 203k. `count(<unknown>.*)` is a runtime error (unknown source in aggregate).
do
  local data = { { a = 1 } }
  local ok, err = pcall(function()
    local _ = query [[
      from d = data
      select all { n = count(q.*) }
    ]]
  end)
  assertTrue(not ok, "203k: expected error for unknown source 'q'")
  assertTrue(
    err and string.find(tostring(err), "q"),
    "203k: error should mention unknown source"
  )
end

-- 203l. Other aggregates accept `*` (operating on whole row values).
-- `first(*)` returns the first non-null value — with wildcard, the value is the
-- row itself, so the result is the first row.
do
  local data = { { v = 10 }, { v = 20 } }
  local r = query [[
    from d = data
    select all { first_row = first(*) }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].first_row.v, 10)
end

-- 203m. Bare `count()` still works (no argument at all).
do
  local data = { { v = 1 }, { v = 2 }, { v = 3 } }
  local r = query [[
    from d = data
    select all { n = count() }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].n, 3)
end

-- 203n. `having count(*) > N` filters groups by cardinality.
do
  local data = {
    { g = "a", v = 1 },
    { g = "a", v = 2 },
    { g = "b", v = 3 },
    { g = "c", v = 4 },
    { g = "c", v = 5 },
    { g = "c", v = 6 },
  }
  local r = query [[
    from d = data
    group by d.g
    having count(*) >= 2
    select all { g = d.g, n = count(*) }
    order by d.g
  ]]
  assertEquals(#r, 2, "203n: only 'a' and 'c' qualify")
  assertEquals(r[1].g, "a"); assertEquals(r[1].n, 2)
  assertEquals(r[2].g, "c"); assertEquals(r[2].n, 3)
end

-- 203o. `array_agg(*)` collects whole rows.
do
  local data = { { v = 1 }, { v = 2 } }
  local r = query [[
    from d = data
    select all { rows = array_agg(*) }
  ]]
  assertEquals(#r, 1)
  assertEquals(#r[1].rows, 2)
  assertEquals(r[1].rows[1].v, 1)
  assertEquals(r[1].rows[2].v, 2)
end

-- 203p. `array_agg(<source>.*)` collects rows from that source only.
do
  local xs = { { x = 1 }, { x = 2 } }
  local ys = { { y = 1 } }
  local r = query [[
    from a = xs, b = ys
    select all { collected = array_agg(a.*) }
  ]]
  assertEquals(#r, 1)
  -- Cross-join produces 2 rows total, array_agg(a.*) collects the `a`
  -- projection of each.
  assertEquals(#r[1].collected, 2)
  assertEquals(r[1].collected[1].x, 1)
  assertEquals(r[1].collected[2].x, 2)
end

-- 203q. `sum(<source>.*)` is rejected. Postgres raises "function sum(record)
-- does not exist"; SLIQ raises an aligned error rather than silently coercing
-- a row table to garbage via JS `+` (`0 + {}` -> "0[object Object]").
do
  local rel = {
    { col = 1, col2 = 10 },
    { col = 2, col2 = 20 },
  }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      select all { s = sum(r.*) }
    ]]
  end)
  assertTrue(not ok, "203q: sum(<source>.*) should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'sum'"),
    "203q: error should mention aggregate 'sum'"
  )
  assertTrue(
    err and string.find(tostring(err), "wildcard argument 'r%.%*'"),
    "203q: error should mention the offending wildcard argument"
  )
  assertTrue(
    err and string.find(tostring(err), "column expression"),
    "203q: error should hint at using a column expression"
  )
end

-- 203r. `sum(*)` is rejected for the same reason.
do
  local rel = { { v = 1 }, { v = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      select all { s = sum(*) }
    ]]
  end)
  assertTrue(not ok, "203r: sum(*) should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'sum'"),
    "203r: error should mention aggregate 'sum'"
  )
  assertTrue(
    err and string.find(tostring(err), "wildcard argument '%*'"),
    "203r: error should mention '*' as the wildcard argument"
  )
end

-- 203s. Numeric aggregates reject wildcards: `avg(r.*)`.
do
  local rel = { { v = 1 }, { v = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      select all { x = avg(r.*) }
    ]]
  end)
  assertTrue(not ok, "203s: avg(r.*) should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'avg'"),
    "203s: error should mention aggregate 'avg'"
  )
end

-- 203s2. Numeric aggregates reject wildcards: `product(r.*)`.
do
  local rel = { { v = 1 }, { v = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      select all { x = product(r.*) }
    ]]
  end)
  assertTrue(not ok, "203s2: product(r.*) should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'product'"),
    "203s2: error should mention aggregate 'product'"
  )
end

-- 203t. `min(<src>.*)` returns the lexicographically smallest record,
-- aligning with Postgres' record ordering. Records compare column by column
-- in their (insertion-stable) key order; here col1 differs between rows so
-- only the first column drives the result.
do
  local rel = {
    { col1 = 3, col2 = 9 },
    { col1 = 1, col2 = 7 },
    { col1 = 2, col2 = 5 },
  }
  local r = query [[
    from x = rel
    select all { lo = min(x.*), hi = max(x.*) }
  ]]
  assertEquals(r[1].lo.col1, 1, "203t: min(x.*) picks the row with smallest col1")
  assertEquals(r[1].lo.col2, 7, "203t: min(x.*) preserves the rest of the row")
  assertEquals(r[1].hi.col1, 3, "203t: max(x.*) picks the row with largest col1")
  assertEquals(r[1].hi.col2, 9, "203t: max(x.*) preserves the rest of the row")
end

-- 203t2. `min/max(<src>.*)` ties on the first column fall through to the
-- next column, just like PG's lex record comparison.
do
  local rel = {
    { a = 1, b = 5 },
    { a = 1, b = 2 },
    { a = 1, b = 9 },
  }
  local r = query [[
    from x = rel
    select all { lo = min(x.*), hi = max(x.*) }
  ]]
  assertEquals(r[1].lo.b, 2, "203t2: tie on a -> min by b")
  assertEquals(r[1].hi.b, 9, "203t2: tie on a -> max by b")
end

-- 203u. String aggregate rejects wildcards.
do
  local rel = { { v = 1 }, { v = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      select all { x = string_agg(r.*) }
    ]]
  end)
  assertTrue(not ok, "203u: string_agg(r.*) should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'string_agg'"),
    "203u: error should mention aggregate 'string_agg'"
  )
end

-- 203u2. Bitwise aggregate rejects wildcards.
do
  local rel = { { v = 1 }, { v = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      select all { x = bit_and(r.*) }
    ]]
  end)
  assertTrue(not ok, "203u2: bit_and(r.*) should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'bit_and'"),
    "203u2: error should mention aggregate 'bit_and'"
  )
end

-- 203u3. Boolean aggregate rejects wildcards.
do
  local rel = { { v = 1 }, { v = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      select all { x = bool_or(r.*) }
    ]]
  end)
  assertTrue(not ok, "203u3: bool_or(r.*) should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'bool_or'"),
    "203u3: error should mention aggregate 'bool_or'"
  )
end

-- 203v. Statistical aggregate rejects wildcards.
do
  local rel = { { v = 1 }, { v = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      select all { x = stddev_pop(r.*) }
    ]]
  end)
  assertTrue(not ok, "203v: stddev_pop(r.*) should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'stddev_pop'"),
    "203v: error should mention aggregate 'stddev_pop'"
  )
end

-- 203v2. Mode aggregate rejects wildcards.
do
  local rel = { { v = 1 }, { v = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      select all { x = mode(r.*) }
    ]]
  end)
  assertTrue(not ok, "203v2: mode(r.*) should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'mode'"),
    "203v2: error should mention aggregate 'mode'"
  )
end

-- 203v3. Quantile/percentile aggregates reject wildcards (which would also
-- collide with their required quantile argument).
do
  local rel = { { v = 1 }, { v = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      select all { x = median(r.*) }
    ]]
  end)
  assertTrue(not ok, "203v3: median(r.*) should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'median'"),
    "203v3: error should mention aggregate 'median'"
  )
end

-- 203w. `last(<source>.*)` returns the last row -- row-accepting aggregate.
do
  local rel = { { v = 10 }, { v = 20 }, { v = 30 } }
  local r = query [[
    from x = rel
    select all { final = last(x.*) }
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].final.v, 30)
end

-- 203x. `yaml_agg(<source>.*)` and `json_agg(<source>.*)` serialize whole rows.
do
  local rel = { { v = 1 }, { v = 2 } }
  local r = query [[
    from x = rel
    select all { y = yaml_agg(x.*), j = json_agg(x.*) }
  ]]
  assertEquals(#r, 1)
  -- json_agg yields a JSON array of records; just check it parses-as-text.
  assertTrue(
    string.find(tostring(r[1].j), '"v":1') ~= nil,
    "203x: json_agg should serialize rows including their fields"
  )
  assertTrue(
    string.find(tostring(r[1].j), '"v":2') ~= nil,
    "203x: json_agg should include the second row"
  )
  -- yaml_agg yields a YAML doc; check both rows are represented.
  assertTrue(
    string.find(tostring(r[1].y), "v: 1") ~= nil,
    "203x: yaml_agg should serialize rows with their fields"
  )
  assertTrue(
    string.find(tostring(r[1].y), "v: 2") ~= nil,
    "203x: yaml_agg should include the second row"
  )
end

-- 203y. Wildcards in aggregates are rejected even with `group by`, so the
-- error fires per-group consistently.
do
  local rel = {
    { g = "a", col = 1, col2 = 10 },
    { g = "a", col = 2, col2 = 20 },
    { g = "b", col = 3, col2 = 30 },
  }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      group by r.g
      select all { g = r.g, s = sum(r.*) }
    ]]
  end)
  assertTrue(not ok, "203y: sum(r.*) should still be rejected with group by")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'sum'"),
    "203y: error should mention aggregate 'sum'"
  )
end

-- 203z. `having sum(r.*) > 0` is rejected (having-clause aggregate path).
do
  local rel = { { g = "a", col = 1 }, { g = "b", col = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from r = rel
      group by r.g
      having sum(r.*) > 0
      select all { g = r.g }
    ]]
  end)
  assertTrue(not ok, "203z: sum(r.*) in having should be rejected")
  assertTrue(
    err and string.find(tostring(err), "aggregate 'sum'"),
    "203z: error should mention aggregate 'sum'"
  )
end

-- 204a. Tagged-float regression: floating-point division (`/`) returns a
-- LuaTaggedFloat box for integer-valued results (5/5 -> {value:1,...}).
-- Aggregates must untag inputs at the iteration boundary, otherwise raw JS
-- `+=` would coerce to "0[object Object]...". Same shape for `^`.
do
  local rel = {
    { col1 = 1, col2 = 2 },
    { col1 = 3, col2 = 4 },
    { col1 = 5, col2 = 6 },
    { col1 = 7, col2 = 8 },
    { col1 = 9, col2 = 10 },
  }
  local r = query [[
    from x = rel
    select all {
      s_div = sum(x.col1 + x.col2 / x.col2),
      s_pow = sum(x.col1 + x.col2 ^ 0),
      s_idiv = sum(x.col1 + x.col2 // x.col2),
    }
  ]]
  -- col1 sum is 1+3+5+7+9 = 25; each row contributes +1 -> 30.
  assertEquals(r[1].s_div, 30, "204a: sum with `/` returns a number, not garbage")
  assertEquals(r[1].s_pow, 30, "204a: sum with `^` returns a number, not garbage")
  assertEquals(r[1].s_idiv, 30, "204a: sum with `//` keeps working")
end

-- 204b. avg / product / median over tagged-float arithmetic also stay
-- numeric instead of stringifying.
do
  local rel = {
    { v = 4 },
    { v = 9 },
    { v = 16 },
  }
  local r = query [[
    from x = rel
    select all {
      a = avg(x.v / 1),
      p = product(x.v / 1),
      m = median(x.v / 1),
    }
  ]]
  assertEquals(r[1].a, (4 + 9 + 16) / 3, "204b: avg over tagged floats")
  assertEquals(r[1].p, 4 * 9 * 16, "204b: product over tagged floats")
  assertEquals(r[1].m, 9, "204b: median over tagged floats")
end

-- 204c. string_agg untags numeric inputs so floats render as numbers, not
-- "[object Object]".
do
  local rel = {
    { v = 2 },
    { v = 4 },
  }
  local r = query [[
    from x = rel
    select all { s = string_agg(x.v / 1, "-") }
  ]]
  assertEquals(r[1].s, "2-4", "204c: string_agg untags tagged floats")
end

-- 204d. min/max over tagged-float values compare numerically and return the
-- original (possibly tagged) value rather than collapsing on object identity.
do
  local rel = {
    { v = 5 },
    { v = 1 },
    { v = 3 },
  }
  local r = query [[
    from x = rel
    select all { lo = min(x.v / 1), hi = max(x.v / 1) }
  ]]
  assertEquals(r[1].lo, 1, "204d: min over tagged floats picks numeric minimum")
  assertEquals(r[1].hi, 5, "204d: max over tagged floats picks numeric maximum")
end

-- 204e. Strict null-record semantics: `count(t.*)` skips rows whose
-- `t`-projection is all-null (Postgres-aligned). `count(*)` still counts
-- every row, since it asks "how many rows" not "how many non-null records".
do
  local rel = {
    { a = 1, b = 2 },
    { a = nil, b = nil }, -- empty Lua table -> all-null record -> skipped by `count(r.*)`
    { a = 3, b = nil },
    {},
    { a = 5, b = 6 },
  }
  local r = query [[
    from r = rel
    select all {
      total = count(*),
      nonnull = count(r.*),
    }
  ]]
  assertEquals(r[1].total, 5, "204e: count(*) counts every row, all-null included")
  assertEquals(r[1].nonnull, 3, "204e: count(r.*) skips all-null records")
end

-- 205. Diagnostics for unresolved names and duplicate output columns

local function isUnresolvedNameError(err, name)
  local s = tostring(err or "")
  if not string.find(s, '"' .. name .. '"', 1, true) then
    return false
  end
  if string.find(s, "does not exist", 1, true) then return true end
  if string.find(s, "missing 'from' clause entry", 1, true) then return true end
  if string.find(s, "missing FROM-clause entry", 1, true) then return true end
  return false
end

-- 205a. `count(<unknown_var>)` must error: previously it silently returned 0
-- because `Variable("t")` resolved to `nil` and `count` skipped nulls. The
-- user had no way to discover the typo. Postgres raises 42P01 / 42703 here.
do
  local data = { { a = 1 }, { a = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from d = data
      select all { n = count(t) }
    ]]
  end)
  assertTrue(not ok, "count(t) returned without erroring")
  assertTrue(isUnresolvedNameError(err, "t"),
    "expected PG-aligned diagnostic naming 't'; got: " .. tostring(err))
end

-- 205b. `select <unknown>.col` must error with a message that names the
-- offending source. Previously the only signal was the generic Lua message
-- "attempt to index a nil value", which neither pointed at `t` nor
-- distinguished "missing FROM entry" from "actual nil column".
do
  local data = { { a = 1 } }
  local ok, err = pcall(function()
    local _ = query [[
      from d = data
      select all { v = t.col }
    ]]
  end)
  assertTrue(not ok, "select t.col returned without erroring")
  assertTrue(isUnresolvedNameError(err, "t"),
    "expected PG-aligned diagnostic naming 't'; got: " .. tostring(err))
end

-- 205c. Same problem inside an aggregate. `sum(t.col)` with no `t` source
-- used to be effectively `sum(nil)` (returns 0); it should error and name `t`.
do
  local data = { { a = 1 }, { a = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from d = data
      select all { s = sum(t.col) }
    ]]
  end)
  assertTrue(not ok, "sum(t.col) returned without erroring")
  assertTrue(isUnresolvedNameError(err, "t"),
    "expected PG-aligned diagnostic naming 't'; got: " .. tostring(err))
end

-- 205d. The unresolved-name diagnostic must not fire when the name resolves
-- to a value in the surrounding Lua scope. `helper.value` is a regular Lua
-- reference and must work the same way it does outside a query.
do
  local data = { { a = 1 }, { a = 2 } }
  local helper = { value = 10 }
  local r = query [[
    from d = data
    select all { sum = sum(d.a + helper.value) }
  ]]
  assertEquals(r[1].sum, 23)
end

-- 205e. Two unaliased aggregate calls in the same `select` produce two
-- distinct columns.
-- second silently overwrote the first. Postgres allows duplicate output
-- names, but since our result is a hash-keyed Lua table we disambiguate
-- with `_2`, `_3`, etc., suffixes: the first occurrence keeps the bare name
-- so simple queries like `select max(x)` still expose `r[1].max`.
do
  local rel = { { a = 1, b = 100 }, { a = 2, b = 200 }, { a = 3, b = 300 } }
  local r = query [[
    from r = rel
    select all { max(r.a), max(r.b) }
  ]]
  assertEquals(r[1].max, 3)
  assertEquals(r[1].max_2, 300)
end

-- 205f. The collision is specific to auto-derived names: explicit aliases
-- always work
do
  local rel = { { a = 1, b = 100 }, { a = 2, b = 200 }, { a = 3, b = 300 } }
  local r = query [[
    from r = rel
    select all { ma = max(r.a), mb = max(r.b) }
  ]]
  assertEquals(r[1].ma, 3)
  assertEquals(r[1].mb, 300)
end

-- 205g. An explicit alias must take precedence over an auto-derived name
-- that would have collided with it. `max(r.a)` derives `max`, but the
-- explicit `max = ...` reservation means the auto-derived one becomes
-- `max_2` instead of overwriting the alias.
do
  local rel = { { a = 1, b = 100 }, { a = 2, b = 200 }, { a = 3, b = 300 } }
  local r = query [[
    from r = rel
    select all { max = sum(r.a), max(r.b) }
  ]]
  assertEquals(r[1].max, 6)
  assertEquals(r[1].max_2, 300)
end

-- 206. Implicit project must behave like an explicit `select *`

-- 206a. Cross-join, no select: must flatten to one row per join match with
-- both sources' columns merged at the top level under qualified keys
-- (`a_<col>`, `b_<col>`), matching the behavior of an explicit `select *`.
do
  local xs = { { x = 1, shared = "left" }, { x = 2, shared = "left" } }
  local ys = { { y = 10 }, { y = 20 } }
  local r_implicit = query [[
    from a = xs, b = ys
    order by a.x, b.y
  ]]
  local r_explicit = query [[
    from a = xs, b = ys
    select *
    order by a.x, b.y
  ]]
  assertEquals(#r_implicit, #r_explicit)
  for i = 1, #r_implicit do
    assertEquals(r_implicit[i].a_x, r_explicit[i].a_x,
      "206a: a_x mismatch at row " .. i)
    assertEquals(r_implicit[i].b_y, r_explicit[i].b_y,
      "206a: b_y mismatch at row " .. i)
    assertEquals(r_implicit[i].a_shared, r_explicit[i].a_shared,
      "206a: a_shared mismatch at row " .. i)
    -- The implicit form must NOT expose the alias-keyed nested rows.
    assertTrue(not hasKey(r_implicit[i], "a"),
      "206a: implicit project leaked nested 'a' key")
    assertTrue(not hasKey(r_implicit[i], "b"),
      "206a: implicit project leaked nested 'b' key")
  end
end

-- 206b. The single-source case is already flat with or without a select, so
-- the implicit form must keep matching `select *`.
do
  local rel = { { v = 1 }, { v = 2 } }
  local r_implicit = query [[
    from r = rel
    order by r.v
  ]]
  local r_explicit = query [[
    from r = rel
    select *
    order by r.v
  ]]
  assertEquals(#r_implicit, #r_explicit)
  for i = 1, #r_implicit do
    assertEquals(r_implicit[i].v, r_explicit[i].v,
      "206b: v mismatch at row " .. i)
  end
end

-- 206c. Equi-join, no select: column merge keeps both sides' contributions
-- under qualified `<source>_<col>` keys, so overlapping column names like
-- `id` and `shared` no longer silently overwrite each other (as a literal
-- `select *` over the join would produce).
do
  local xs = { { id = 1, shared = "from-a" }, { id = 2, shared = "from-a" } }
  local ys = {
    { id = 1, shared = "from-b" },
    { id = 2, shared = "from-b" },
  }
  local r = query [[
    from a = xs, b = ys
    where a.id == b.id
    order by a.id
  ]]
  assertEquals(#r, 2)
  -- Both ids are preserved.
  assertEquals(r[1].a_id, 1)
  assertEquals(r[1].b_id, 1)
  assertEquals(r[2].a_id, 2)
  assertEquals(r[2].b_id, 2)
  -- Both `shared` columns are preserved with their original values.
  assertEquals(r[1].a_shared, "from-a")
  assertEquals(r[1].b_shared, "from-b")
  assertEquals(r[2].a_shared, "from-a")
  assertEquals(r[2].b_shared, "from-b")
  -- The bare `id`/`shared` keys must not leak through.
  assertTrue(not hasKey(r[1], "id"), "206c: bare 'id' should not be present")
  assertTrue(
    not hasKey(r[1], "shared"),
    "206c: bare 'shared' should not be present"
  )
end

-- 207. Wildcard fields in 'select' are allowed under grouping when every
-- column they would expand is provably in the group key. The simplest case
-- is `select source.* ... group by source.*`, but `group by *` (covering
-- everything) and the multi-source variant are also supported.

-- 207a. Brace form: `select { p.*, n = count() } group by p.*` works and
-- emits one row per distinct (dept, level) tuple with the count.
do
  local ps = {
    { dept = "eng", level = 1 },
    { dept = "eng", level = 1 },
    { dept = "eng", level = 2 },
    { dept = "sales", level = 1 },
  }
  local r = query [[
    from p = ps
    group by p.*
    select { p.*, n = count() }
    order by p.dept, p.level
  ]]
  assertEquals(#r, 3, "207a: distinct (dept, level) groups")
  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].level, 1)
  assertEquals(r[1].n, 2)
  assertEquals(r[2].dept, "eng")
  assertEquals(r[2].level, 2)
  assertEquals(r[2].n, 1)
  assertEquals(r[3].dept, "sales")
  assertEquals(r[3].level, 1)
  assertEquals(r[3].n, 1)
end

-- 207b. Bare list form: parity with the brace form above.
do
  local ps = {
    { dept = "eng", level = 1 },
    { dept = "eng", level = 1 },
    { dept = "sales", level = 1 },
  }
  local r = query [[
    from p = ps
    group by p.*
    select p.*, n = count()
    order by p.dept
  ]]
  assertEquals(#r, 2)
  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].n, 2)
  assertEquals(r[2].dept, "sales")
  assertEquals(r[2].n, 1)
end

-- 207c. Wildcard select with no aggregate must also work under grouping —
-- previously the dispatch silently routed through plain `evalExpression`
-- which doesn't know about wildcard fields.
do
  local ps = {
    { dept = "eng", level = 1 },
    { dept = "eng", level = 1 },
    { dept = "sales", level = 2 },
  }
  local r = query [[
    from p = ps
    group by p.*
    select { p.* }
    order by p.dept
  ]]
  assertEquals(#r, 2)
  assertEquals(r[1].dept, "eng")
  assertEquals(r[1].level, 1)
  assertEquals(r[2].dept, "sales")
  assertEquals(r[2].level, 2)
end

-- 207d. `select *` with `group by *` on a single-source query is the
-- "expand everything" shorthand and must be honoured.
do
  local data = {
    { cat = "a", val = 1 },
    { cat = "a", val = 1 },
    { cat = "b", val = 2 },
  }
  local r = query [[
    from p = data
    group by *
    select *, n = count()
    order by p.cat, p.val
  ]]
  assertEquals(#r, 2)
  assertEquals(r[1].cat, "a")
  assertEquals(r[1].val, 1)
  assertEquals(r[1].n, 2)
  assertEquals(r[2].cat, "b")
  assertEquals(r[2].val, 2)
  assertEquals(r[2].n, 1)
end

-- 207e. Multi-source: every source is wildcard-grouped, so `select *`
-- flattens both sources' columns post-group under qualified
-- `<source>_<col>` keys.
do
  local ps = { { id = 1, dept = "eng" } }
  local qs = { { id = 1, tag = "x" }, { id = 1, tag = "y" } }
  local r = query [[
    from p = ps, q = qs
    where p.id == q.id
    group by p.*, q.*
    select *, n = count()
    order by q.tag
  ]]
  assertEquals(#r, 2)
  assertEquals(r[1].p_id, 1)
  assertEquals(r[1].p_dept, "eng")
  assertEquals(r[1].q_id, 1)
  assertEquals(r[1].q_tag, "x")
  assertEquals(r[1].n, 1)
  assertEquals(r[2].p_dept, "eng")
  assertEquals(r[2].q_tag, "y")
  assertEquals(r[2].n, 1)
  -- The result must be flat: no residual alias keys, no bare `id`/`dept`.
  assertTrue(not hasKey(r[1], "p"), "207e: leaked alias 'p'")
  assertTrue(not hasKey(r[1], "q"), "207e: leaked alias 'q'")
  assertTrue(not hasKey(r[1], "id"), "207e: bare 'id' should not be present")
  assertTrue(not hasKey(r[1], "dept"), "207e: bare 'dept' should not be present")
end

-- 207f. Multi-source where only one source is wildcard-grouped: the
-- wildcarded source's columns can still be expanded in select, and they
-- come out qualified.
do
  local ps = { { dept = "eng" }, { dept = "sales" } }
  local qs = { { tag = "x" }, { tag = "y" } }
  local r = query [[
    from p = ps, q = qs
    group by p.*
    select p.*, n = count()
    order by p.dept
  ]]
  assertEquals(#r, 2)
  assertEquals(r[1].p_dept, "eng")
  assertEquals(r[1].n, 2, "207f: 1 p-row * 2 q-rows")
  assertEquals(r[2].p_dept, "sales")
  assertEquals(r[2].n, 2)
  assertTrue(not hasKey(r[1], "dept"), "207f: bare 'dept' should not be present")
end

-- 207g. Implicit aggregation (no group by) rejects `*` in the select list
do
  local data = { { a = 1 }, { a = 2 } }
  local ok, err = pcall(function()
    local _ = query [[
      from x = data
      select *, n = count()
    ]]
  end)
  assertTrue(not ok, "207g: expected error for `select *, count()` without group by")
  assertTrue(
    err and string.find(tostring(err), "group by"),
    "207g: error should mention 'group by': " .. tostring(err)
  )
end

-- 207h. `select source.*` when only some columns of `source` are in
-- the group key. Postgres allows it via functional-dependency inference;
-- SLIQ is conservative and requires `group by source.*` to take the
-- wildcard shortcut.
do
  local ps = {
    { dept = "eng", level = 1 },
    { dept = "eng", level = 2 },
  }
  local ok, err = pcall(function()
    local _ = query [[
      from p = ps
      group by p.dept
      select p.*, n = count()
    ]]
  end)
  assertTrue(not ok, "207h: expected error for `select p.*` without `group by p.*`")
  assertTrue(
    err and string.find(tostring(err), "p%.%*"),
    "207h: error should mention the wildcard: " .. tostring(err)
  )
end

-- 207i. `select *.col` is never recoverable post-grouping because
-- `group by *.col` is rejected at parse time.
do
  local ps = { { name = "a" }, { name = "b" } }
  local ok, err = pcall(function()
    local _ = query [[
      from p = ps
      group by p.*
      select *.name, n = count()
    ]]
  end)
  assertTrue(not ok, "207i: expected error for `select *.name` under grouping")
  assertTrue(
    err and string.find(tostring(err), "%*%.name"),
    "207i: error should mention the wildcard: " .. tostring(err)
  )
end

-- 207j. `select t.*` where `t` is not in the FROM clause must
-- surface the standard "missing 'from' clause entry" diagnostic.
do
  local ps = { { dept = "eng" } }
  local ok, err = pcall(function()
    local _ = query [[
      from p = ps
      group by p.*
      select t.*, n = count()
    ]]
  end)
  assertTrue(not ok, "207j: expected error for unknown source 't' in select")
  assertTrue(
    err and string.find(tostring(err), 'missing \'from\' clause entry for table "t"'),
    "207j: error should mention missing FROM entry for t: " .. tostring(err)
  )
end

-- 207k. Brace form parity with bare list for the wildcard + count case.
do
  local ps = {
    { dept = "eng", level = 1 },
    { dept = "eng", level = 2 },
    { dept = "eng", level = 2 },
  }
  local r1 = query [[
    from p = ps
    group by p.*
    select p.*, n = count()
    order by p.dept, p.level
  ]]
  local r2 = query [[
    from p = ps
    group by p.*
    select { p.*, n = count() }
    order by p.dept, p.level
  ]]
  assertEquals(#r1, #r2)
  for i = 1, #r1 do
    assertEquals(r1[i].dept, r2[i].dept)
    assertEquals(r1[i].level, r2[i].level)
    assertEquals(r1[i].n, r2[i].n)
  end
end

-- 208. Multi-source column qualification
--
-- Multi-source queries qualify wildcard outputs and auto-derived
-- `source.column` keys with `<source>_<column>`, so that overlapping column
-- names cannot silently overwrite each other. Single-source queries keep
-- bare column names. Explicit aliases (`alias = expr`) always win and stay
-- unqualified regardless of source count.

-- 208a. `select *` preserves overlapping columns from both sources under
-- qualified keys (no silent overwrite).
do
  local xs = { { id = 1, name = "alice" }, { id = 2, name = "bob" } }
  local ys = { { id = 10, name = "alpha" }, { id = 20, name = "bravo" } }
  local r = query [[
    from a = xs, b = ys
    where a.id == 1 and b.id == 10
    select *
  ]]
  assertEquals(#r, 1, "208a: row count")
  assertEquals(r[1].a_id, 1)
  assertEquals(r[1].a_name, "alice")
  assertEquals(r[1].b_id, 10)
  assertEquals(r[1].b_name, "alpha")
  assertTrue(not hasKey(r[1], "id"), "208a: bare 'id' must not leak")
  assertTrue(not hasKey(r[1], "name"), "208a: bare 'name' must not leak")
end

-- 208b. `select t.*, p.*` produces qualified keys per source (bare list
-- form). Same shape as `select *` over the same FROM.
do
  local ts = { { id = 1, x = "tx" } }
  local ps = { { id = 2, x = "px" } }
  local r = query [[
    from t = ts, p = ps
    select t.*, p.*
    order by t.id
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].t_id, 1)
  assertEquals(r[1].t_x, "tx")
  assertEquals(r[1].p_id, 2)
  assertEquals(r[1].p_x, "px")
end

-- 208c. Mixing `t.*` with a single bare `p.col`: the wildcard expands
-- qualified, and the explicit `p.col` auto-derives to `p_col` so it can't
-- collide with anything from `t.*`.
do
  local ts = { { id = 1, name = "tee" } }
  local ps = { { id = 99, name = "pee" } }
  local r = query [[
    from t = ts, p = ps
    select t.*, p.name
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].t_id, 1)
  assertEquals(r[1].t_name, "tee")
  assertEquals(r[1].p_name, "pee")
  -- Bare `name` (which would have been the silent winner before) must not leak.
  assertTrue(not hasKey(r[1], "name"), "208c: bare 'name' must not leak")
end

-- 208d. Explicit aliases always win over auto-qualification, in both
-- multi- and single-source contexts.
do
  local xs = { { id = 1 } }
  local ys = { { id = 2 } }
  local r = query [[
    from a = xs, b = ys
    select aid = a.id, bid = b.id
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].aid, 1)
  assertEquals(r[1].bid, 2)
  assertTrue(not hasKey(r[1], "a_id"), "208d: a_id must not leak (alias used)")
  assertTrue(not hasKey(r[1], "b_id"), "208d: b_id must not leak (alias used)")
end

-- 208e. Single-source `select r.col1, r.col2` auto-derives BARE column
-- names (`col1`, `col2`)
do
  local rel = { { v = 1, w = 10 }, { v = 2, w = 20 } }
  local r = query [[
    from r = rel
    select r.v, r.w
    order by r.v
  ]]
  assertEquals(#r, 2)
  assertEquals(r[1].v, 1)
  assertEquals(r[1].w, 10)
  assertEquals(r[2].v, 2)
  assertEquals(r[2].w, 20)
  assertTrue(not hasKey(r[1], "r_v"), "208e: r_v must not leak in single-source")
  assertTrue(not hasKey(r[1], "r.v"), '208e: "r.v" must not leak in single-source')
end

-- 208f. Single-source `select *` and `s.*` keep bare column names.
do
  local rel = { { x = 1, y = 2 } }
  local r1 = query [[ from r = rel select * ]]
  local r2 = query [[ from r = rel select r.* ]]
  assertEquals(#r1, 1); assertEquals(#r2, 1)
  assertEquals(r1[1].x, 1); assertEquals(r1[1].y, 2)
  assertEquals(r2[1].x, 1); assertEquals(r2[1].y, 2)
  assertTrue(not hasKey(r1[1], "r_x"), "208f: r_x must not leak in single-source select *")
  assertTrue(not hasKey(r2[1], "r_x"), "208f: r_x must not leak in single-source select r.*")
end

-- 208g. Auto-derived names: multi-source `select a.col, b.col` qualifies BOTH
do
  local xs = { { val = 1 } }
  local ys = { { val = 100 } }
  local r = query [[
    from a = xs, b = ys
    select a.val, b.val
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].a_val, 1)
  assertEquals(r[1].b_val, 100)
  assertTrue(not hasKey(r[1], "val"), "208g: bare 'val' must not leak")
  assertTrue(not hasKey(r[1], "val_2"), "208g: 'val_2' fallback must not be used")
end

-- 208h. `group by *` deliberately merges columns across sources, so its
-- post-group projection keeps bare keys regardless of source count
do
  local ps = { { id = 1 } }
  local qs = { { id = 1 } }
  local r = query [[
    from p = ps, q = qs
    where p.id == q.id
    group by *
    select *, n = count()
  ]]
  assertEquals(#r, 1)
  -- `group by *` merged both `id` columns into one key, so the post-group
  -- projection has bare `id`, not `p_id`/`q_id`.
  assertEquals(r[1].id, 1)
  assertEquals(r[1].n, 1)
end

-- 208i. Multi-source `*.col`
do
  local xs = { { v = 1 } }
  local ys = { { v = 10 } }
  local r = query [[
    from a = xs, b = ys
    select *.v
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].a_v, 1)
  assertEquals(r[1].b_v, 10)
  assertTrue(not hasKey(r[1], "v"), "208i: bare 'v' must not leak")
end

-- 208j. Mixed: `select t.*, alias = p.col`
do
  local ts = { { id = 1, x = "tx" } }
  local ps = { { id = 2, x = "px", extra = "ex" } }
  local r = query [[
    from t = ts, p = ps
    select t.*, e = p.extra
  ]]
  assertEquals(#r, 1)
  assertEquals(r[1].t_id, 1)
  assertEquals(r[1].t_x, "tx")
  assertEquals(r[1].e, "ex")
  assertTrue(not hasKey(r[1], "extra"), "208j: bare 'extra' must not leak")
  assertTrue(not hasKey(r[1], "p_extra"), "208j: p_extra must not leak (alias wins)")
end
