local function assertEquals(a, b)
  if a ~= b then
    error("Assertion failed: "
      .. tostring(a) .. " is not equal to "
      .. tostring(b))
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

-- 1. Basic `from`
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

  assertEquals(r[1].name, "Alice")
end

-- 2. Select/projection: direct, binding, mixed
do
  local r = query [[
    from
      pages
    select {
      n = name,
      t = tags[1],
    }
  ]]

  assertEquals(r[1].n, "Alice")
end

do
  local r = query [[
    from
      p = pages
    select {
      n = p.name,
      t = p.tags[1],
    }
  ]]

  assertEquals(r[2].n, "Bob")
end

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

-- 3. Select field, select as array, order/limit/offset, where
do
  local r1 = query [[
    from
      pages
    select {
      value = size,
    }
  ]]

  assertEquals(r1[1].value, 10)

  local r2 = query [[
    from
      p = pages
    select {
      value = p.size,
    }
  ]]

  assertEquals(r2[1].value, 10)
end

do
  local r1 = query [[
    from
      pages
    limit 2
    select {
      name = name,
    }
  ]]

  assertEquals(#r1, 2)

  local r2 = query [[
    from
      p = pages
    limit 3, 2
    select {
      name = p.name,
    }
  ]]

  assertEquals(r2[1].name, "Carol")
end

do
  local r1 = query [[
    from
      pages
    order by
      size desc
    select {
      name = name,
    }
  ]]

  assert(r1[1].name == "Bob")

  local r2 = query [[
    from
      p = pages
    order by
      p.age
    select {
      age = p.age,
    }
  ]]

  assert(r2[1].age == 19)
end

do
  local r1 = query [[
    from
      pages
    where
      size > 10
    select {
      name = name,
    }
  ]]

  assert(r1[1].name == "Bob")

  local r2 = query [[
    from
      p = pages
    where
      p.age < 30
    select {
      name = p.name,
    }
  ]]

  assert(r2[1].name == "Bob",
    "Expected Bob in r2[1], got " .. tostring(r2[1] and r2[1].name))

  assert(r2[2].name == "Ed",
    "Expected Ed in r2[2], got " .. tostring(r2[2] and r2[2].name))
end

-- 4. Grouping/group select

do
  local r1 = query [[
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
  local r2 = query [[
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

  assert(type(r1[1].key) == "string" or r1[1].key == nil)
  assert(#r1 == #r2)
end

do
  local r1 = query [[
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
  local r2 = query [[
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

  assert(#r1 == #r2)
end

do
  local r = query [[
    from
      pages
    group by
      tags[1]
    select {
      k = key,
      gc = #group,
      first = group[1].name,
      f2 = group[1].tags[2],
    }
  ]]

  assert(type(r[1].k) == "string" or r[1].k == nil)
  assert(type(r[1].gc) == "number")
end

do
  local r = query [[
    from
      p = pages
    group by
      p.tags[1]
    select {
      k = key,
      gc = #group,
      n = group[1].name,
    }
  ]]

  assert(type(r[1].gc) == "number")
end

do
  local r = query [[
    from
      pages
    group by
      tags[1]
    select {
      k = key,
      n = group[1].name,
      t = group[1].tags[1],
    }
  ]]

  assert(type(r[1].k) == "string" or r[1].k == nil)
end

-- 5. Aggregation/builtins

do
  local r1 = query [[
    from
      pages
    group by
      tags[1]
    select {
      count = count(name),
    }
  ]]
  local r2 = query [[
    from
      p = pages
    group by
      p.tags[1]
    select {
      count = count(p.name),
    }
  ]]

  assert(type(r1[1].count) == "number")
  assert(#r1 == #r2)
end

do
  local r1 = query [[
    from
      pages
    group by
      tags[1]
    select {
      min = min(age),
      max = max(age),
      avg = avg(age),
      sum = sum(age),
    }
  ]]
  local r2 = query [[
    from
      p = pages
    group by
      p.tags[1]
    select {
      min = min(p.size),
      max = max(p.size),
      avg = avg(p.size),
      sum = sum(p.size),
    }
  ]]

  for _, row in ipairs(r2) do
    assert(type(row.min) == "number" or row.min == nil)
    assert(type(row.avg) == "number" or row.avg == nil)
  end
end

do
  local r1 = query [[
    from
      pages
    group by
      tags[1]
    select {
      arr = array_agg(name),
    }
  ]]
  local r2 = query [[
    from
      p = pages
    group by
      p.tags[1]
    select {
      arr = array_agg(p.name),
    }
  ]]

  assert(type(r1[1].arr) == "table" or r1[1].arr == nil)
  assert(#r1 == #r2)
end

do
  local r = query [[
    from
      pages
    group by
      tags[1]
    select {
      c = count(name),
      v = min(size),
      x = p and count(p.name),
    }
  ]]

  assert(type(r[1].c) == "number")
end

-- 6. `having`

do
  local r1 = query [[
    from
      pages
    group by
      tags[1]
    having
      count(name) > 1
    select {
      key = key,
    }
  ]]
  local r2 = query [[
    from
      p = pages
    group by
      p.tags[1]
    having
      count(p.name) > 1
    select {
      key = key,
    }
  ]]

  assertEquals(#r1, #r2)
end

do
  local r = query [[
    from
      p = pages
    group by
      p.tags[1]
    having
      sum(p.size) > 15
    select {
      key = key,
    }
  ]]

  assert((#r > 0), "expected some groups")
end

-- 7. Full pipeline

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
      min_age = min(age),
      avg_size = avg(p.size),
    }
    order by
      avg_size desc
    limit 2
  ]]

  assert(#r <= 2)
end

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
      min_age = min(age),
      avg_size = avg(size),
    }
    order by
      avg_size desc
    limit 2
  ]]

  assert(#r <= 2)
end

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
      p = p and p.name,
      total = count(name),
      avg_size = avg(size),
    }
    order by
      avg_size desc
    limit 2
  ]]

  assert(#r <= 2)
end
