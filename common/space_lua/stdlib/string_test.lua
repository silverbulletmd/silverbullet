local function assertEqual(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end

-- Basic string functions
assert(string.len("Hello") == 5)
assert(string.byte("Hello", 1) == 72)
assert(string.char(72) == "H")
assert(string.find("Hello", "l") == 3)
assert(string.rep("Hello", 3) == "HelloHelloHello")
assert(string.sub("Hello", 2, 4) == "ell")
assert(string.upper("Hello") == "HELLO")
assert(string.lower("Hello") == "hello")

-- string.sub tests
assertEqual(string.sub("hello", 1), "hello")
assertEqual(string.sub("hello", 1, 1), "h")
-- with negative indeses
assertEqual(string.sub("hello", -1), "o")
assertEqual(string.sub("hello", -2), "lo")
assertEqual(string.sub("hello", -2, -1), "lo")

-- Invoke string metatable methods
assertEqual(("hello"):len(), 5)
assertEqual(("hello"):upper(), "HELLO")

-- Test string.gsub with various replacement types
-- Simple string replacement
local result, count = string.gsub("hello world", "hello", "hi")
assert(result == "hi world", "Basic string replacement failed")
assert(count == 1, "Basic replacement count failed")

-- Multiple replacements
result, count = string.gsub("hello hello hello", "hello", "hi")
assert(result == "hi hi hi", "Multiple replacements failed")
assert(count == 3, "Multiple replacement count failed")

-- Limited replacements with n parameter
result, count = string.gsub("hello hello hello", "hello", "hi", 2)
assert(result == "hi hi hello", "Limited replacements failed")
assert(count == 2, "Limited replacement count failed")

-- Function replacement without captures
result = string.gsub("hello world", "hello", function(match)
    assert(match == "hello", "Function received incorrect match")
    return string.upper(match)
end)
assert(result == "HELLO world", "Function replacement without captures failed")

-- Function replacement with single capture
result = string.gsub("hello world", "(h)ello", function(h)
    assert(h == "h", "Function received incorrect capture")
    return string.upper(h) .. "i"
end)
assert(result == "Hi world", "Function replacement with single capture failed")

-- Function replacement with multiple captures
result = string.gsub("hello world", "(h)(e)(l)(l)o", function(h, e, l1, l2)
    assert(h == "h" and e == "e" and l1 == "l" and l2 == "l",
        "Function received incorrect captures: " .. h .. ", " .. e .. ", " .. l1 .. ", " .. l2)
    return string.upper(h) .. string.upper(e) .. l1 .. l2 .. "o"
end)
assert(result == "HEllo world", "Function replacement with multiple captures failed")

-- Function returning nil (should keep original match)
result = string.gsub("hello world", "hello", function() return nil end)
assert(result == "hello world", "Function returning nil failed")

-- Pattern with multiple matches on same position
result = string.gsub("hello world", "h?e", "X")
assert(result == "Xllo world", "Overlapping matches failed")

-- Empty captures
result = string.gsub("hello", "(h()e)", function(full, empty)
    assert(full == "he" and empty == "", "Empty capture handling failed")
    return "XX"
end)
assert(result == "XXllo", "Empty capture replacement failed")

-- Patterns with magic characters
result = string.gsub("hello.world", "%.", "-")
assert(result == "hello-world", "Magic character replacement failed")

-- Test string.match
local m1, m2 = string.match("hello world", "(h)(ello)")
assertEqual(m1, "h")
assertEqual(m2, "ello")

-- Test with pattern with character class
assertEqual(string.match("c", "[abc]"), "c")

-- Test match with init position - need to capture the group
local initMatch = string.match("hello world", "(world)", 7)
assertEqual(initMatch, "world")

-- Test string.gmatch
local words = {}
for word in string.gmatch("hello world lua", "%w+") do
    table.insert(words, word)
end
assertEqual(words[1], "hello")
assertEqual(words[2], "world")
assertEqual(words[3], "lua")

-- Test string.reverse
assertEqual(string.reverse("hello"), "olleh")
assertEqual(string.reverse(""), "")

-- Test string.split
local parts = string.split("a,b,c", ",")
assertEqual(parts[1], "a")
assertEqual(parts[2], "b")
assertEqual(parts[3], "c")

-- Test non-standard string extensions
assertEqual(string.startsWith("hello world", "hello"), true)
assertEqual(string.startsWith("hello world", "world"), false)

assertEqual(string.endsWith("hello world", "world"), true)
assertEqual(string.endsWith("hello world", "hello"), false)

-- Extended string.match tests
-- Basic pattern matching
assertEqual(string.match("hello", "h"), "h")
assertEqual(string.match("hello", "hello"), "hello")

-- Test with no matches
assertEqual(string.match("hello", "x"), nil)

-- Test with captures
local m1, m2 = string.match("hello", "(h)(ello)")
assertEqual(m1, "h")
assertEqual(m2, "ello")

-- Test with init position
local initMatch = string.match("hello world", "(world)", 7)
assertEqual(initMatch, "world")

-- Test init position with no match
assertEqual(string.match("hello world", "hello", 7), nil)

-- Test pattern characters
assertEqual(string.match("123", "%d+"), "123")
assertEqual(string.match("abc123", "%a+"), "abc")
assertEqual(string.match("   abc", "%s+"), "   ")

-- Test multiple captures
local day, month, year = string.match("2024-03-14", "(%d+)-(%d+)-(%d+)")
assertEqual(day, "2024")
assertEqual(month, "03")
assertEqual(year, "14")

-- Test optional captures
local word = string.match("The quick brown fox", "%s*(%w+)%s*")
assertEqual(word, "The")

-- Test matchRegexAll
local matches = {}
for match in string.matchRegexAll("hellolllbl", "(l+)") do
    table.insert(matches, match)
end
assertEqual(#matches, 3)
assertEqual(matches[1][1], "ll")
assertEqual(matches[2][1], "lll")
assertEqual(matches[3][1], "l")
