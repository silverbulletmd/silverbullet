local function assertEquals(actual, expected, message)
  if actual ~= expected then
    error('Assertion failed: ' .. message
      .. ' (expected ' .. tostring(expected)
      .. ', got ' .. tostring(actual) .. ')')
  end
end

local function assertTrue(v, message)
  if v ~= true then
    error('Assertion failed: ' .. message .. ' (expected true)')
  end
end

local function assertFalse(v, message)
  if v ~= false then
    error('Assertion failed: ' .. message .. ' (expected false)')
  end
end

local function assertThrows(msg_substr, fn)
  local ok, err = pcall(fn)

  if ok then
    error('Assertion failed: expected error containing "'
      .. msg_substr .. '"')
  end

  if type(err) ~= 'string' then
    err = tostring(err)
  end

  if not string.find(err, msg_substr, 1, true) then
    error('Assertion failed: expected error message to contain "'
      .. msg_substr .. '", got: "' .. err .. '"')
  end
end

-- 1. Arithmetic + bitwise metamethods: values + multi-return trimming
do
  local mt = {}

  mt.__add = function(a, b) return a.tag .. '+' .. b.tag end
  mt.__sub = function(a, b) return a.tag .. '-' .. b.tag end
  mt.__mul = function(a, b) return a.tag .. '*' .. b.tag end
  mt.__div = function(a, b) return a.tag .. '/' .. b.tag end
  mt.__pow = function(a, b) return a.tag .. '^' .. b.tag end
  mt.__idiv = function(a, b) return a.tag .. '//' .. b.tag end
  mt.__mod = function(a, b) return a.tag .. '%' .. b.tag end
  mt.__unm = function(a) return '(-' .. a.tag .. ')' end
  mt.__bnot = function(a) return '(~' .. a.tag .. ')' end
  mt.__band = function(a, b) return a.tag .. '&' .. b.tag end
  mt.__bor = function(a, b) return a.tag .. '|' .. b.tag end
  mt.__bxor = function(a, b) return a.tag .. '~' .. b.tag end
  mt.__shl = function(a, b) return a.tag .. '<<' .. b.tag end
  mt.__shr = function(a, b) return a.tag .. '>>' .. b.tag end

  local a = setmetatable({ tag = 'A' }, mt)
  local b = setmetatable({ tag = 'B' }, mt)

  assertEquals(a + b, 'A+B', '__add produced correct value')
  assertEquals(a - b, 'A-B', '__sub produced correct value')
  assertEquals(a * b, 'A*B', '__mul produced correct value')
  assertEquals(a / b, 'A/B', '__div produced correct value')
  assertEquals(a ^ b, 'A^B', '__pow produced correct value')
  assertEquals(a // b, 'A//B', '__idiv produced correct value')
  assertEquals(a % b, 'A%B', '__mod produced correct value')

  assertEquals(-a, '(-A)', '__unm produced correct value')
  assertEquals(~a, '(~A)', '__bnot produced correct value')

  assertEquals(a & b, 'A&B', '__band produced correct value')
  assertEquals(a | b, 'A|B', '__bor produced correct value')
  assertEquals(a ~ b, 'A~B', '__bxor produced correct value')
  assertEquals(a << b, 'A<<B', '__shl produced correct value')
  assertEquals(a >> b, 'A>>B', '__shr produced correct value')

  -- Multi-return from metamethod: must take only the first return
  do
    local mt_mr = {
      __add = function(_, _) return 'first', 'second' end,
      __unm = function(_) return 7, 8 end,
      __bnot = function(_) return 9, 10 end,
      __concat = function(_, _) return "c1", "c2" end,
      __len = function(_) return 123, 999 end,
    }

    local x = setmetatable({}, mt_mr)

    assertEquals(x + x, 'first', 'binary operator uses first return value')
    assertEquals(-x, 7, 'unary operator uses first return value')
    assertEquals(~x, 9, 'unary operator uses first return value')
    assertEquals(x .. x, "c1", 'concat uses first return value')
    assertEquals(#x, 123, 'len uses first return value')
  end
end

-- 2. Comparison operators
do
  -- 2.1. No ordering for plain tables
  assertThrows("attempt to compare", function() return ({} < {}) end)
  assertThrows("attempt to compare", function() return ({} <= {}) end)
  assertThrows("attempt to compare", function() return ({} > {}) end)
  assertThrows("attempt to compare", function() return ({} >= {}) end)

  -- 2.2. With metamethods: `__lt` / `__le`
  do
    local mt = {
      __lt = function(a, b) return a.v < b.v end,
      __le = function(a, b) return a.v <= b.v end,
    }
    local function O(v) return setmetatable({ v = v }, mt) end

    assertTrue(O(1) < O(2), "__lt true")
    assertFalse(O(2) < O(1), "__lt false")
    assertTrue(O(2) <= O(2), "__le true")
    assertFalse(O(3) <= O(2), "__le false")
  end

-- 2.3. `__eq` semantics
do
  do
    local a, b = {}, {}
    assertFalse(a == b, "raw equality for distinct tables without __eq is false")
    assertTrue(a == a, "raw equality for same table is true")
  end

  do
    local calls = 0
    local mt = {
      __eq = function(_, _)
        calls = calls + 1
        return true
      end
    }
    local x = setmetatable({}, mt)
    local y = {} -- no metatable

    assertTrue(x == y, "__eq may be used from left operand metatable")
    assertTrue(y == x, "__eq may be used from right operand metatable")
    assertTrue(calls >= 1, "__eq was called at least once")
  end

  do
    local a = setmetatable({ v = 1 }, { __eq = function() return true end })
    local b = setmetatable({ v = 2 }, { __eq = function() return true end })
    assertTrue(a == b, "__eq true/true => true")
    assertFalse(a ~= b, "~= is negation of ==")
  end

  do
    local a = setmetatable({ v = 1 }, { __eq = function() return false end })
    local b = setmetatable({ v = 2 }, { __eq = function() return false end })
    assertFalse(a == b, "__eq false/false => false")
    assertTrue(a ~= b, "~= is negation of ==")
  end
end

-- 2.4. Operand swap rules: `a > b` is `b < a` and `a >= b` is `b <= a`
do
  local mt2 = { __lt = function(a, b) return a.v < b.v end }
  local function P(v) return setmetatable({ v = v }, mt2) end

  local a = P(3)
  local b = P(2)

  assertTrue(b < a, "sanity: b < a uses __lt")
  assertTrue(a > b, '">" uses swapped __lt')
  assertFalse(b > a, '">" uses swapped __lt (false case)')
end

do
  local mt3 = { __le = function(a, b) return a.v <= b.v end }
  local function P(v) return setmetatable({ v = v }, mt3) end

  local a = P(3)
  local b = P(2)

  assertTrue(b <= a, "sanity: b <= a uses __le")
  assertTrue(a >= b, '">=" uses swapped __le')
  assertFalse(b >= a, '">=" uses swapped __le (false case)')
end

-- 2.5. No `__le` fallback via `__lt` in Lua for metamethod comparisons
do
  local mt = { __lt = function(a, b) return a.v < b.v end }
  local function P(v) return setmetatable({ v = v }, mt) end

  local a = P(2)
  local b = P(2)

  assertFalse(a < b, "sanity: 2 < 2 is false via __lt")
  assertThrows("attempt to compare", function() return a <= b end)
end

do
  local mt = {
    __lt = function(a, b) return a.v < b.v end,
    __le = function(a, b) return a.v <= b.v end,
  }
  local function P(v) return setmetatable({ v = v }, mt) end
  local a = P(2)
  local b = P(2)
  assertTrue(a <= b, "__le works when provided")
end
end

-- 3. `rawlen` vs `#` when `__len` exists
do
  local t = setmetatable({ 1, 2, 3 }, { __len = function() return 10 end })
  assertEquals(#t, 10, '# uses __len')
  assertEquals(rawlen(t), 3, 'rawlen ignores __len on tables')
  assertEquals(rawlen("abc"), 3, 'rawlen works on strings')
end

-- 4. `__len`: tables use metamethod; strings are raw length
do
  local t = setmetatable({ x = 20 }, { __len = function(tt) return tt.x end })
  assertEquals(#t, 20, '__len dispatched for tables')
  t.x = "234"
  assertEquals(#t, "234", '__len can return non-number')
end

do
  local s = "abc"
  assertEquals(#s, 3, 'strings ignore __len metamethod')
end

-- 5. `__concat`: produced value and number/table interop
do
  local a = setmetatable({ x = "u" }, {
    __concat = function(l, r) return l.x .. "." .. r.x end
  })
  assertEquals(a .. a, "u.u", '__concat dispatched')
end

do
  local c = {}
  setmetatable(c, {
    __concat = function(a, b)
      if type(a) == "number" then
        assertEquals(b, c, '__concat rhs is c when lhs number')
        return "n..c"
      else
        assertEquals(a, c, '__concat lhs is c when rhs number')
        return "c..n"
      end
    end
  })
  assertEquals(c .. 5, "c..n", "__concat handles table .. number")
  assertEquals(5 .. c, "n..c", "__concat handles number .. table")
end

-- 6. `__call`: produced values
do
  local t = setmetatable({}, {
    __call = function(self, a, b)
      assertEquals(type(self), 'table', '__call self is table')
      return a + b
    end
  })
  assertEquals(t(2, 3), 5, '__call dispatched')
end

do
  local t = setmetatable({}, {
    __call = function(_, ...)
      return "a", "b", select('#', ...)
    end
  })
  local a, b, n = t(10, 20)
  assertEquals(a, "a", "__call multi-return first")
  assertEquals(b, "b", "__call multi-return second")
  assertEquals(n, 2, "__call sees arguments")
end

do
  local n = 200
  local function leaf()
    if n == 0 then return 1023 end
    n = n - 1
    return leaf()
  end

  local f = leaf
  for _ = 1, 50 do
    f = setmetatable({}, { __call = f })
  end

  assertEquals(f(), 1023, 'chain of __call metamethods works')
end

do
  local i = 0
  local tt = {
    __call = function(t, ...)
      i = i + 1
      if t.f then return t.f(...) end
      return {...}
    end
  }

  local a = setmetatable({}, tt)
  local b = setmetatable({ f = a }, tt)
  local c = setmetatable({ f = b }, tt)

  local x = c(3, 4, 5)
  assertEquals(i, 3, "__call nested chain increments i")
  assertEquals(x[1], 3, "__call nested chain arg1")
  assertEquals(x[2], 4, "__call nested chain arg2")
  assertEquals(x[3], 5, "__call nested chain arg3")
end

do
  local t = setmetatable({}, { __call = 123 })
  assertThrows("attempt to call a number value", function()
    return t()
  end)
end

-- 7. `__index` / `__newindex`: function + table forms
do
  local backing = { x = 10 }
  local t = setmetatable({}, {
    __index = function(_, k) return backing[k] end,
    __newindex = function(_, k, v) backing[k] = v end,
  })

  assertEquals(t.x, 10, '__index function dispatched')
  t.y = 20
  assertEquals(backing.y, 20, '__newindex function dispatched')
end

do
  local backing = { a = 1, b = 2 }
  local t = setmetatable({}, { __index = backing })
  assertEquals(t.a, 1, '__index table dispatched (a)')
  assertEquals(t.b, 2, '__index table dispatched (b)')
  assertEquals(t.c, nil, '__index table missing key yields nil')
end

do
  -- __newindex as table target (Lua 5.4)
  local backing = {}
  local t = setmetatable({}, { __newindex = backing })
  t.k = 99
  assertEquals(backing.k, 99, '__newindex table dispatched')
end

do
  local calls = 0
  local t = { present = 1 }
  setmetatable(t, {
    __newindex = function(tt, k, v)
      calls = calls + 1
      rawset(tt, k, v)
    end
  })

  t.present = 2
  assertEquals(calls, 0, '__newindex not called for existing key')

  t.absent = 3
  assertEquals(calls, 1, '__newindex called for absent key')
  assertEquals(t.absent, 3, '__newindex stored value')
end

do
  local a = {}
  setmetatable(a, a)
  a.__index = a
  a.__newindex = a

  assertThrows("chain too long", function()
    local _ = a[10]
  end)

  assertThrows("chain too long", function()
    a[10] = true
  end)
end

-- 8. `__pairs` and `ipairs` via `__index`-backed table
do
  local a = {}
  local out = {}

  local function foo(e, i)
    assertEquals(e, a, "__pairs sees original table")
    if i < 10 then
      return i + 1, i + 2
    end
  end

  setmetatable(a, { __pairs = function(x) return foo, x, 0 end })

  local i = 0
  for k, v in pairs(a) do
    i = i + 1
    out[i] = { k, v }
  end

  assertEquals(i, 10, "__pairs loop count")
  assertEquals(out[1][1], 1, "__pairs k1")
  assertEquals(out[1][2], 2, "__pairs v1")
  assertEquals(out[10][1], 10, "__pairs k10")
  assertEquals(out[10][2], 11, "__pairs v10")
end

do
  local a = { n = 5 }
  setmetatable(a, {
    __index = function(t, k)
      if type(k) == "number" and k <= t.n then
        return k * 10
      end
    end
  })

  local out = {}
  for k, v in ipairs(a) do
    out[#out + 1] = k .. ":" .. v
  end

  assertEquals(#out, 5, "ipairs iterates n entries via __index")
  assertEquals(out[1], "1:10", "ipairs entry 1")
  assertEquals(out[5], "5:50", "ipairs entry 5")
end

-- 9. `table` library interaction with metamethods
do
  local function check_proxy(proxy, backing)
    for i = 1, 10 do
      table.insert(proxy, 1, i)
    end
    assertEquals(#proxy, 10, "proxy length after inserts")
    assertEquals(#backing, 10, "backing length after inserts")

    for i = 1, 10 do
      assertEquals(backing[i], 11 - i, "backing reversed insert " .. i)
    end

    table.sort(proxy)
    for i = 1, 10 do
      assertEquals(backing[i], i, "backing sorted " .. i)
      assertEquals(proxy[i], i, "proxy sorted " .. i)
    end

    assertEquals(table.concat(proxy, ","), "1,2,3,4,5,6,7,8,9,10", "table.concat(proxy)")

    for i = 1, 8 do
      assertEquals(table.remove(proxy, 1), i, "table.remove(proxy,1) yields i")
    end
    assertEquals(#proxy, 2, "proxy length after removes")
    assertEquals(#backing, 2, "backing length after removes")

    local a, b, c = table.unpack(proxy)
    assertEquals(a, 9, "table.unpack(proxy) first")
    assertEquals(b, 10, "table.unpack(proxy) second")
    assertEquals(c, nil, "table.unpack(proxy) third nil")
  end

  local backing = {}
  local proxy = setmetatable({}, {
    __len = function() return #backing end,
    __index = backing,
    __newindex = backing,
  })
  check_proxy(proxy, backing)
end

-- 10. Comparison compatibility corner: metamethod dispatch present
do
  local mt1 = {
    __eq = function() return true end,
    __lt = function() return true end,
    __le = function() return false end,
  }

  local c = setmetatable({}, mt1)
  local d = setmetatable({}, mt1)

  assertTrue(c == d, "comparison compat: __eq true (same mt)")
  assertTrue(c < d, "comparison compat: __lt true (same mt)")
  assertFalse(d <= c, "comparison compat: __le false (same mt)")

  local mt2 = {
    __eq = mt1.__eq,
    __lt = mt1.__lt,
    __le = mt1.__le,
  }
  local e = setmetatable({}, mt1)
  local f = setmetatable({}, mt2)

  assertTrue(e == f, "comparison compat across metatables: __eq")
  assertTrue(e < f, "comparison compat across metatables: __lt")
  assertFalse(f <= e, "comparison compat across metatables: __le")
end

-- 11. Concat chain associativity + returning table from `__concat`
do
  local t = {}
  t.__concat = function(a, b)
    local av = (type(a) == "table") and a.val or tostring(a)
    local bv = (type(b) == "table") and b.val or tostring(b)
    return setmetatable({ val = av .. bv }, t)
  end

  local c = setmetatable({ val = "c" }, t)
  local d = setmetatable({ val = "d" }, t)

  local x = c .. d .. c .. d
  assertEquals(type(x), "table", "__concat chain returns table")
  assertEquals(x.val, "cdcd", "__concat chain value")
end

-- 12. `__eq` is not used for table indexing / hashing
do
  local mt = {}
  mt.__eq = function(_, _) return true end

  local function Set(x)
    local t = {}
    for _, k in pairs(x) do t[k] = true end
    return setmetatable(t, mt)
  end

  local k1 = Set{1, 2, 3}
  local k2 = Set{1, 2, 3}

  assertTrue(k1 == k2, "__eq says equal")
  assertFalse(rawequal(k1, k2), "not the same object")

  local t = {}
  t[k1] = 123

  assertEquals(t[k2], nil, "table indexing ignores __eq")
  assertEquals(t[k1], 123, "table indexing by same object works")
end

-- 13. operator metamethod lookup must be raw (no `__index` involvement)
do
  local mt = {
    __index = function(_, _)
      return function() return "BAD" end
    end
  }

  local a = setmetatable({}, mt)

  assertThrows("attempt to perform arithmetic on a table value", function()
    local _ = a + a
  end)
end

-- 14. `__tostring`: must return a string
do
  local m = setmetatable({ name = "NAME" }, {
    __tostring = function(x) return x.name end
  })
  assertEquals(tostring(m), "NAME", "__tostring used by tostring()")
end

do
  local m = setmetatable({}, {
    __tostring = function() return {} end
  })
  assertThrows("'__tostring' must return a string", function()
    return tostring(m)
  end)
end
