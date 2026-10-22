local function assertEqual(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end


local s = crypto.sha256(encoding.utf8Encode("test"))
local s2 = crypto.sha256("test")
assertEqual(s, s2)

assertEqual(crypto.sha1("abc"), "a9993e364706816aba3e25717850c26c9cd0d89d")
assertEqual(crypto.sha1(encoding.utf8Encode("abc")), crypto.sha1("abc"))
