-- ( exp ) must truncate a multi-return to exactly one value (Lua 5.4 semantics).
-- string.gsub returns 2 values (string, count); parens must drop the count.

-- 1: parenthesized call yields arity 1
assert(select("#", (string.gsub("a:b", ":", " "))) == 1, "paren call arity should be 1")

-- 2: a function returning (multi) yields arity 1
local function mk() return (string.gsub("a:b", ":", " ")) end
assert(select("#", mk()) == 1, "return (multi) should yield arity 1")

-- 3: table.insert with a parenthesized-returning call inserts exactly one element
local t1 = {}
table.insert(t1, mk())
assert(#t1 == 1, "table.insert should add one element, got " .. #t1)
assert(t1[1] == "a b", "inserted value should be the gsub string, got " .. tostring(t1[1]))

-- 4: table.insert with an inline parenthesized gsub
local t2 = {}
table.insert(t2, (string.gsub("a:b", ":", " ")))
assert(#t2 == 1, "inline paren insert should add one element, got " .. #t2)

-- 5: contrast — binding to a local already worked; must still work
local t3 = {}
local v = mk()
table.insert(t3, v)
assert(#t3 == 1, "local-bound insert should add one element")

-- 6: multiple assignment from a parenthesized multi-return drops extra values
local a, b = (string.gsub("a:b", ":", " "))
assert(a == "a b", "first value preserved")
assert(b == nil, "parenthesized truncation should leave b nil, got " .. tostring(b))

-- 7: an UNparenthesized trailing call must still expand (no regression)
local function multi() return string.gsub("a:b", ":", " ") end
assert(select("#", multi()) == 2, "unparenthesized return must still expand to 2")
