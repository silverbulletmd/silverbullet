local function assert_equal(a, b)
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
assert_equal(m1, "h")
assert_equal(m2, "ello")

-- Test match with init position - need to capture the group
local init_match = string.match("hello world", "(world)", 7)
assert_equal(init_match, "world")

-- Test string.gmatch
local words = {}
for word in string.gmatch("hello world lua", "%w+") do
    table.insert(words, word)
end
assert_equal(words[1], "hello")
assert_equal(words[2], "world")
assert_equal(words[3], "lua")

-- Test string.reverse
assert_equal(string.reverse("hello"), "olleh")
assert_equal(string.reverse(""), "")

-- Test string.split
local parts = string.split("a,b,c", ",")
assert_equal(parts[1], "a")
assert_equal(parts[2], "b")
assert_equal(parts[3], "c")

-- Test non-standard string extensions
assert_equal(string.startswith("hello world", "hello"), true)
assert_equal(string.startswith("hello world", "world"), false)

assert_equal(string.endswith("hello world", "world"), true)
assert_equal(string.endswith("hello world", "hello"), false)

 
