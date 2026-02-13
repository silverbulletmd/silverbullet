local function assertEqual(a, b)
    if a ~= b then
        error("Assertion failed: " .. tostring(a) .. " ~= " .. tostring(b))
    end
end

local function assertError(f, expectedMsg)
    local ok, err = pcall(f)
    assert(not ok, "Expected error but call succeeded")
    local msg = tostring(err)
    -- Strip stack trace prefix if present (e.g. "LuaRuntimeError: ...")
    local clean = msg:match(":%s*(.+)$") or msg
    assert(clean:find(expectedMsg, 1, true),
        "Expected error containing '" .. expectedMsg .. "' but got: " .. msg)
end

-- 1. Character classes

-- %a / %A
assertEqual(string.match("hello123", "%a+"), "hello")
assertEqual(string.match("123hello", "%A+"), "123")

-- %d / %D
assertEqual(string.match("abc42xyz", "%d+"), "42")
assertEqual(string.match("42abc", "%D+"), "abc")

-- %l / %L (lowercase)
assertEqual(string.match("Hello", "%l+"), "ello")
assertEqual(string.match("hello", "%L+"), nil)

-- %u / %U (uppercase)
assertEqual(string.match("helloWORLD", "%u+"), "WORLD")
assertEqual(string.match("HELLO", "%U+"), nil)

-- %w / %W (alphanumeric)
assertEqual(string.match("hello world", "%w+"), "hello")
assertEqual(string.match("hello world", "%W+"), " ")

-- %s / %S (whitespace)
assertEqual(string.match("hello world", "%s+"), " ")
assertEqual(string.match("  hello", "%S+"), "hello")

-- %p (punctuation)
assertEqual(string.match("hello, world!", "%p+"), ",")

-- %g (printable, non-space)
assertEqual(string.match("  abc  ", "%g+"), "abc")

-- %x (hex digits)
assertEqual(string.match("ghABCDij", "%x+"), "ABCD")

-- %. (dot matches any)
assertEqual(string.match("abc", "."), "a")
assertEqual(string.match("abc", ".."), "ab")

-- 2. Anchors

assertEqual(string.match("hello", "^hello$"), "hello")
assertEqual(string.match("hello world", "^hello$"), nil)
assertEqual(string.match("hello", "^h"), "h")
assertEqual(string.match("hello", "o$"), "o")
assertEqual(string.match("hello", "x$"), nil)

-- 3. Repetition: *, +, -, ?

-- * (greedy, 0 or more)
assertEqual(string.match("aaa", "a*"), "aaa")
assertEqual(string.match("bbb", "a*"), "")

-- + (greedy, 1 or more)
assertEqual(string.match("aaa", "a+"), "aaa")
assertEqual(string.match("bbb", "a+"), nil)

-- - (lazy, 0 or more)
assertEqual(string.match("aaa", "a-b"), nil)
assertEqual(string.match("aab", "a-b"), "aab")
-- lazy match takes shortest prefix
local cap = string.match("<tag>content</tag>", "<(.-)>")
assertEqual(cap, "tag")

-- ? (optional)
assertEqual(string.match("colour", "colou?r"), "colour")
assertEqual(string.match("color", "colou?r"), "color")

-- 4. Escaping magic characters with %

assertEqual(string.match("100%", "(%d+)%%"), "100")
assertEqual(string.match("hello.world", "(%a+)%.(%a+)"), "hello")
assertEqual(string.match("a+b", "a%+b"), "a+b")
assertEqual(string.match("a*b", "a%*b"), "a*b")
assertEqual(string.match("(x)", "%(x%)"), "(x)")

-- Non-magic chars after % are literal
assertEqual(string.match("*", "%*"), "*")
assertEqual(string.match("?", "%?"), "?")

-- 5. Character sets [...]

assertEqual(string.match("cat", "[abc]"), "c")
assertEqual(string.match("dog", "[abc]"), nil)

-- Ranges
assertEqual(string.match("m", "[a-z]"), "m")
assertEqual(string.match("M", "[a-z]"), nil)
assertEqual(string.match("5", "[0-9]"), "5")

-- Negated set
assertEqual(string.match("x", "[^abc]"), "x")
assertEqual(string.match("a", "[^abc]"), nil)

-- Classes inside sets
assertEqual(string.match("3", "[%d]"), "3")
assertEqual(string.match("a", "[%d]"), nil)

-- 6. Captures

-- Single capture
local y, m, d = string.match("2024-03-14", "(%d+)-(%d+)-(%d+)")
assertEqual(y, "2024")
assertEqual(m, "03")
assertEqual(d, "14")

-- No captures returns whole match
assertEqual(string.match("hello", "%a+"), "hello")

-- Nested captures
local outer, inner = string.match("hello world", "(h(ello))")
assertEqual(outer, "hello")
assertEqual(inner, "ello")

-- Captures with literal parens
local content = string.match("((test))", "%((%(%a+%))%)")
assertEqual(content, "(test)")

-- Multiple captures
local a, b = string.match("hello world", "(%a+) (%a+)")
assertEqual(a, "hello")
assertEqual(b, "world")

-- 7. Position captures ()

local p1, p2 = string.match("hello", "()()")
assertEqual(p1, 1)
assertEqual(p2, 1)

local pos = string.match("hello world", "()world")
assertEqual(pos, 7)

-- 8. Back-references %1-%9

-- Match repeated word
local word = string.match("hello hello", "(%a+) %1")
assertEqual(word, "hello")

-- No match if different
assertEqual(string.match("hello world", "(%a+) %1"), nil)

-- Match repeated char
local ch = string.match("aabcc", "(.)%1")
assertEqual(ch, "a")

-- 9. Balanced match %bxy

assertEqual(string.match("(hello (world))", "%b()"), "(hello (world))")
assertEqual(string.match("{a{b}c}", "%b{}"), "{a{b}c}")
assertEqual(string.match("(unbalanced", "%b()"), nil)

-- 10. Frontier pattern %f[set]

-- Transition from non-alpha to alpha
local fw = string.match("hello world", "%f[%a]%a+", 2)
assertEqual(fw, "world")

-- Transition at string start
local fs = string.match("hello", "%f[%a]%a+")
assertEqual(fs, "hello")

-- Word boundaries
local words = {}
for w in string.gmatch("one two three", "%f[%a]%a+") do
    table.insert(words, w)
end
assertEqual(#words, 3)
assertEqual(words[1], "one")
assertEqual(words[2], "two")
assertEqual(words[3], "three")

-- 11. string.find

-- Basic find
local s, e = string.find("hello world", "world")
assertEqual(s, 7)
assertEqual(e, 11)

-- Plain find
s, e = string.find("hello.world", ".", 1, true)
assertEqual(s, 6)
assertEqual(e, 6)

-- Find with captures
local s2, e2, c1 = string.find("hello world", "(%a+)")
assertEqual(s2, 1)
assertEqual(e2, 5)
assertEqual(c1, "hello")

-- Not found
assertEqual(string.find("hello", "xyz"), nil)

-- Find with init
s, e = string.find("abcabc", "abc", 2)
assertEqual(s, 4)
assertEqual(e, 6)

-- Find returns nil (not false)
assert(string.find("a", "b") == nil)
assert(not (string.find("a", "b") ~= nil))

-- Find with special chars
local bf = string.find("[", "[_%w]")
assert(bf == nil)

-- 12. string.match

-- Match from init position
assertEqual(string.match("abcdef", "%a+", 4), "def")

-- Match empty pattern
assertEqual(string.match("abc", ""), "")

-- Match returns nil (not false)
assert(string.match("a", "b") == nil)
assert(not (string.match("a", "b") ~= nil))

-- Match with init
local initMatch = string.match("hello world", "(world)", 7)
assertEqual(initMatch, "world")

-- 13. string.gmatch

-- Basic iteration
local t = {}
for w in string.gmatch("hello world lua", "%a+") do
    table.insert(t, w)
end
assertEqual(#t, 3)
assertEqual(t[1], "hello")
assertEqual(t[2], "world")
assertEqual(t[3], "lua")

-- With captures
local kv = {}
for k, v in string.gmatch("from=world, to=Lua", "(%w+)=(%w+)") do
    kv[k] = v
end
assertEqual(kv.from, "world")
assertEqual(kv.to, "Lua")

-- gmatch with empty matches (like Lua reference: ";a;" with "a*")
local r = {}
for mm in string.gmatch(";a;", "a*") do
    table.insert(r, mm)
end
assertEqual(r[1], "")
assertEqual(r[2], "a")
assertEqual(r[3], "")

-- gmatch without captures returns whole match
local t2 = {}
for mm in string.gmatch("from=world, to=Lua", "%w+=%w+") do
    table.insert(t2, mm)
end
assertEqual(t2[1], "from=world")
assertEqual(t2[2], "to=Lua")

-- 14. string.gsub

-- Simple string replacement
local res, count = string.gsub("hello world", "(%w+)", "%1-%1")
assertEqual(res, "hello-hello world-world")
assertEqual(count, 2)

-- Limited replacements
res, count = string.gsub("aaa", "a", "b", 2)
assertEqual(res, "bba")
assertEqual(count, 2)

-- Replacement with %0
res = string.gsub("hello", "%w+", "[%0]")
assertEqual(res, "[hello]")

-- Function replacement
res, count = string.gsub("hello world", "%w+", function(w)
    return w:upper()
end)
assertEqual(res, "HELLO WORLD")
assertEqual(count, 2)

-- Function returning nil keeps original
res = string.gsub("hello world", "%w+", function(w)
    if w == "hello" then return "HI" end
end)
assertEqual(res, "HI world")

-- Table replacement
local tbl = {hello = "HI", world = "EARTH"}
res = string.gsub("hello world", "(%w+)", tbl)
assertEqual(res, "HI EARTH")

-- Table with missing key keeps original
tbl = {hello = "HI"}
res = string.gsub("hello world", "(%w+)", tbl)
assertEqual(res, "HI world")

-- gsub with magic chars in pattern
res = string.gsub("hello.world", "%.", "-")
assertEqual(res, "hello-world")

-- gsub %% in replacement
res = string.gsub("hello", "hello", "100%%")
assertEqual(res, "100%")

-- Empty pattern match (inserts between every char)
res = string.gsub("abc", "", "-")
assertEqual(res, "-a-b-c-")

-- Anchored gsub
res, count = string.gsub("abc", "^a", "x")
assertEqual(res, "xbc")
assertEqual(count, 1)

-- gsub with XML pattern
local xmlpat = '<%?xml version="1.0" encoding="UTF%-8"%?>'
local xmlstr = '<?xml version="1.0" encoding="UTF-8"?><my-xml></my-xml>'
res = string.gsub(xmlstr, xmlpat, "moo")
assertEqual(res, "moo<my-xml></my-xml>")

-- gsub with %%1
res = string.gsub("Hello %1", "%%1", "world")
assertEqual(res, "Hello world")

-- gsub counting digits
res, count = string.gsub("ab5kfd8scf4lll", "%d", "")
assertEqual(res, "abkfdscflll")
assertEqual(count, 3)

-- 15. The dash (lazy) vs literal dash

assertEqual(string.match("2024-03-14", "%d+-(%d+)-%d+"), "03")
assertEqual(string.match("2024-03-14", "(%d+)-(%d+)-(%d+)"), "2024")

local y2, m2, d2 = string.match("2024-03-14", "(%d+)-(%d+)-(%d+)")
assertEqual(y2, "2024")
assertEqual(m2, "03")
assertEqual(d2, "14")

-- 16. Edge cases

-- Empty string
assertEqual(string.match("", ".*"), "")
local fs2, fe2 = string.find("", "")
assertEqual(fs2, 1)
assertEqual(fe2, 0)

-- Pattern matching entire string
assertEqual(string.match("abc", "^(.-)$"), "abc")

-- Pattern at end of string
assertEqual(string.match("test!", "!$"), "!")

-- Multiple position captures
local p3, p4 = string.match("abcd", "()ab()cd")
assertEqual(p3, 1)
assertEqual(p4, 3)

-- string.rep with separator
assertEqual(string.rep("ab", 3, ","), "ab,ab,ab")
assertEqual(string.rep("x", 1, ","), "x")
assertEqual(string.rep("x", 0), "")

-- 17. More complex patterns

-- CSV-like parsing
local fields = {}
for f in string.gmatch("one,two,,four", "([^,]*)") do
    table.insert(fields, f)
end
assertEqual(fields[1], "one")
assertEqual(fields[2], "two")
assertEqual(fields[3], "")
assertEqual(fields[4], "four")

-- Trim whitespace
local function trim(s2)
    return string.match(s2, "^%s*(.-)%s*$")
end
assertEqual(trim("  hello  "), "hello")
assertEqual(trim("hello"), "hello")
assertEqual(trim("  "), "")

-- Match identifier
assertEqual(string.match("my_var123", "^[%a_][%w_]*$"), "my_var123")
assertEqual(string.match("123bad", "^[%a_][%w_]*$"), nil)

-- Hex color
local hex = string.match("#FF00AA", "^#(%x%x)(%x%x)(%x%x)$")
assertEqual(hex, "FF")

local r2, g, b2 = string.match("#FF00AA", "^#(%x%x)(%x%x)(%x%x)$")
assertEqual(r2, "FF")
assertEqual(g, "00")
assertEqual(b2, "AA")

-- Email-like pattern
local user, domain = string.match("user@example.com", "([%w_.]+)@([%w_.]+)")
assertEqual(user, "user")
assertEqual(domain, "example.com")

-- 18. Error cases — malformed patterns

-- Pattern ending with lone %
assertError(function()
    string.find("abc", "abc%")
end, "malformed pattern (ends with '%')")

assertError(function()
    string.match("abc", "%")
end, "malformed pattern (ends with '%')")

assertError(function()
    local iter = string.gmatch("abc", "a%")
    iter()
end, "malformed pattern (ends with '%')")

-- %b with missing arguments
assertError(function()
    string.match("abc", "%b")
end, "malformed pattern (missing arguments to '%b')")

assertError(function()
    string.match("abc", "%b(")
end, "malformed pattern (missing arguments to '%b')")

-- %f not followed by [
assertError(function()
    string.match("abc", "%f")
end, "missing '[' after '%f' in pattern")

assertError(function()
    string.match("abc", "%fa")
end, "missing '[' after '%f' in pattern")

-- Lone % at end of replacement
assertError(function()
    string.gsub("abc", "a", "x%")
end, "invalid use of '%' in replacement string")

-- Invalid escape in replacement
assertError(function()
    string.gsub("abc", "a", "%z")
end, "invalid use of '%' in replacement string")

-- 19. Error cases — invalid captures

-- Unmatched close paren
assertError(function()
    string.match("abc", ")")
end, "invalid pattern capture")

-- Back-reference to non-existent capture
assertError(function()
    string.match("abc", "%1")
end, "invalid capture index")

-- Back-reference to capture not yet closed
assertError(function()
    string.match("abab", "(%a+%1)")
end, "invalid capture index")

-- Too high capture index in replacement
assertError(function()
    string.gsub("abc", "(%a+)", "%2")
end, "invalid capture index")

-- Unfinished capture used in match (tries to return it)
assertError(function()
    string.match("abc", "(abc")
end, "unfinished capture")

-- Unfinished capture used in find (tries to return it)
assertError(function()
    string.find("abc", "(abc")
end, "unfinished capture")

-- Nested unfinished capture
assertError(function()
    string.match("abc", "(ab(c)")
end, "unfinished capture")

-- 20. Error cases — %b and %f

-- %b with missing arguments
assertError(function()
    string.match("abc", "%b")
end, "malformed pattern (missing arguments to '%b')")

assertError(function()
    string.match("abc", "%b(")
end, "malformed pattern (missing arguments to '%b')")

-- %f not followed by [
assertError(function()
    string.match("abc", "%f")
end, "missing '[' after '%f' in pattern")

assertError(function()
    string.match("abc", "%fa")
end, "missing '[' after '%f' in pattern")

-- 21. Error cases — gsub replacement string

-- Lone % at end of replacement
assertError(function()
    string.gsub("abc", "a", "x%")
end, "invalid use of '%' in replacement string")

-- Invalid escape in replacement (not a digit or %)
assertError(function()
    string.gsub("abc", "a", "%z")
end, "invalid use of '%' in replacement string")

-- %2 when only one capture exists
assertError(function()
    string.gsub("abc", "(a)", "%2")
end, "invalid capture index")

-- %9 with no captures at all
assertError(function()
    string.gsub("abc", "a", "%9")
end, "invalid capture index")

-- 22. Error cases — too many captures

assertError(function()
    local pat = string.rep("(", 33) .. "a" .. string.rep(")", 33)
    string.match("a", pat)
end, "too many captures")

-- 23. Error cases — unfinished capture

-- Open paren never closed
assertError(function()
    string.find("abc", "(abc")
end, "unfinished capture")

assertError(function()
    string.match("abc", "(ab(c)")
end, "unfinished capture")
