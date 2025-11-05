local function assertEqual(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end


local s = crypto.sha256(encoding.utf8Encode("test"))
local s2 = crypto.sha256("test")
assertEqual(s, s2)
