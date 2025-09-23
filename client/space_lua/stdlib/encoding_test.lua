local function assertEqual(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end


assertEqual(encoding.utf8Decode(encoding.utf8Encode("test")), "test")
assertEqual(encoding.utf8Decode(encoding.base64Decode(encoding.base64Encode("test"))), "test")
