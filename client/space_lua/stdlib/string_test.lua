local function assertEqual(a, b)
    if a ~= b then
        error("Assertion failed: " .. tostring(a) .. " is not equal to " .. tostring(b))
    end
end

-- Basic string functions
assert(string.len("Hello") == 5)
assert(string.byte("Hello", 1) == 72)
assert(string.char(72) == "H")
assert(string.rep("Hello", 3) == "HelloHelloHello")
assert(string.sub("Hello", 2, 4) == "ell")
assert(string.upper("Hello") == "HELLO")
assert(string.lower("Hello") == "hello")

-- string.byte tests
local a, b = string.byte('Mo0')
assert(a == 77, 'string.byte() should return the code for the first char')
assert(b == nil, 'string.byte() should return only one item when no length is given')

a, b = string.byte('Mo0', 2)
assert(a == 111, 'string.byte() should return the code for the nth character')
assert(b == nil, 'string.byte() should return only one item when no length is given')

local a2, b2, c2 = string.byte('Mo0', 2, 3)
assert(a2 == 111, 'string.byte() multi-return [1]')
assert(b2 == 48, 'string.byte() multi-return [2]')
assert(c2 == nil, 'string.byte() should stop at end of string')

a2, b2 = string.byte('Mo0', 3, 20)
assert(a2 == 48, 'string.byte() should clamp to string length')
assert(b2 == nil, 'string.byte() should not return past end of string')

-- string.char tests
assertEqual(string.char(), '')
assertEqual(string.char(116, 101, 115, 116), 'test')

-- string.len tests
assertEqual(string.len(''), 0)
assertEqual(string.len('McLaren Mercedes'), 16)

-- string.lower tests
assertEqual(string.lower(''), '')
assertEqual(string.lower('McLaren Mercedes'), 'mclaren mercedes')

-- string.upper tests
assertEqual(string.upper(''), '')
assertEqual(string.upper('JavaScript'), 'JAVASCRIPT')

-- string.rep tests
assertEqual(string.rep('Ho', 0), '')
assertEqual(string.rep('Ho', 1), 'Ho')
assertEqual(string.rep('Ho', 3), 'HoHoHo')
assertEqual(string.rep("ab", 3, ","), "ab,ab,ab")
assertEqual(string.rep("x", 1, ","), "x")

-- string.reverse tests
assertEqual(string.reverse(''), '')
assertEqual(string.reverse('x'), 'x')
assertEqual(string.reverse('tpircSavaJ'), 'JavaScript')

-- string.sub tests
assertEqual(string.sub("hello", 1), "hello")
assertEqual(string.sub("hello", 1, 1), "h")
-- with negative indices
assertEqual(string.sub("hello", -1), "o")
assertEqual(string.sub("hello", -2), "lo")
assertEqual(string.sub("hello", -2, -1), "lo")

local s = 'Pub Standards'
assertEqual(string.sub(s, 1), 'Pub Standards')
assertEqual(string.sub(s, 5), 'Standards')
assertEqual(string.sub(s, -4), 'ards')
assertEqual(string.sub(s, 1, 3), 'Pub')
assertEqual(string.sub(s, 7, 9), 'and')
assertEqual(string.sub(s, 5, -2), 'Standard')
assertEqual(string.sub(s, 0), 'Pub Standards')

-- Invoke string metatable methods
assertEqual(("hello"):len(), 5)
assertEqual(("hello"):upper(), "HELLO")
assertEqual(('Hey'):lower(), 'hey')

-- Test string.split (non-standard)
local parts = string.split("a,b,c", ",")
assertEqual(parts[1], "a")
assertEqual(parts[2], "b")
assertEqual(parts[3], "c")

-- Test non-standard string extensions
assertEqual(string.startsWith("hello world", "hello"), true)
assertEqual(string.startsWith("hello world", "world"), false)
assertEqual(string.endsWith("hello world", "world"), true)
assertEqual(string.endsWith("hello world", "hello"), false)

-- Test matchRegexAll (non-standard, regex-based)
local matches = {}
for match in string.matchRegexAll("hellolllbl", "(l+)") do
    table.insert(matches, match)
end
assertEqual(#matches, 3)
assertEqual(matches[1][1], "ll")
assertEqual(matches[2][1], "lll")
assertEqual(matches[3][1], "l")
