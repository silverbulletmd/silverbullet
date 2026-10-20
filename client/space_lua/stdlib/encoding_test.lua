local function assertEqual(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end


assertEqual(encoding.utf8Decode(encoding.utf8Encode("test")), "test")
assertEqual(encoding.utf8Decode(encoding.base64Decode(encoding.base64Encode("test"))), "test")

-- URL encoding (encodeURIComponent / decodeURIComponent)
assertEqual(encoding.urlEncode("Projects/Café Plan"), "Projects%2FCaf%C3%A9%20Plan")
assertEqual(encoding.urlDecode("Projects%2FCaf%C3%A9%20Plan"), "Projects/Café Plan")
assertEqual(encoding.urlDecode(encoding.urlEncode("😀")), "😀")
assertEqual(encoding.urlEncode("😀"), "%F0%9F%98%80")
-- Malformed input is returned unchanged
assertEqual(encoding.urlDecode("%E0%A4%A"), "%E0%A4%A")
