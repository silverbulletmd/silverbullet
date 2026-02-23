local function assertEquals(a, b, msg)
  if a ~= b then
    error((msg or "assertEquals") .. ": expected " .. tostring(b) .. " got " .. tostring(a))
  end
end

local function assertError(fn, msg)
  local ok, err = pcall(fn)
  if ok then error(msg or "expected error") end
end

-- packsize: fixed formats
do
  assertEquals(string.packsize("b"), 1, "packsize b")
  assertEquals(string.packsize("B"), 1, "packsize B")
  assertEquals(string.packsize("h"), 2, "packsize h")
  assertEquals(string.packsize("H"), 2, "packsize H")
  assertEquals(string.packsize("i4"), 4, "packsize i4")
  assertEquals(string.packsize("I4"), 4, "packsize I4")
  assertEquals(string.packsize("i8"), 8, "packsize i8")
  assertEquals(string.packsize("f"), 4, "packsize f")
  assertEquals(string.packsize("d"), 8, "packsize d")
  assertEquals(string.packsize("c10"), 10, "packsize c10")
  assertEquals(string.packsize("i4i4"), 8, "packsize i4i4")

  -- variable-length formats must error
  assertError(function() string.packsize("s4") end, "packsize s4 must error")
  assertError(function() string.packsize("z") end, "packsize z must error")
end

-- little-endian integers
do
  local s = string.pack("<i4", 1)
  assertEquals(#s, 4, "pack i4 length")
  assertEquals(s:byte(1), 1, "pack <i4(1) byte 1")
  assertEquals(s:byte(2), 0, "pack <i4(1) byte 2")
  assertEquals(s:byte(3), 0, "pack <i4(1) byte 3")
  assertEquals(s:byte(4), 0, "pack <i4(1) byte 4")

  local v = string.unpack("<i4", s)
  assertEquals(v, 1, "unpack <i4")

  local s2 = string.pack("<i4", -1)
  local v2 = string.unpack("<i4", s2)
  assertEquals(v2, -1, "unpack <i4 negative")

  local s3 = string.pack("<I4", 0xDEADBEEF)
  local v3 = string.unpack("<I4", s3)
  assertEquals(v3, 0xDEADBEEF, "unpack <I4 0xDEADBEEF")
end

-- big-endian integers
do
  local s = string.pack(">i2", 256)
  assertEquals(s:byte(1), 1, "pack >i2(256) byte 1")
  assertEquals(s:byte(2), 0, "pack >i2(256) byte 2")

  local v = string.unpack(">i2", s)
  assertEquals(v, 256, "unpack >i2")

  local s2 = string.pack(">I2", 0xABCD)
  local v2 = string.unpack(">I2", s2)
  assertEquals(v2, 0xABCD, "unpack >I2")
end

-- byte / unsigned byte
do
  local s = string.pack("BB", 65, 66)
  assertEquals(#s, 2, "pack BB length")

  local a, b, _ = string.unpack("BB", s)
  assertEquals(a, 65, "unpack B first")
  assertEquals(b, 66, "unpack B second")

  -- signed byte: -1 round-trips
  local s2 = string.pack("b", -1)
  local v2 = string.unpack("b", s2)
  assertEquals(v2, -1, "unpack b -1")
end

-- float (f) and double (d)
do
  local s = string.pack("<f", 1.0)
  assertEquals(#s, 4, "pack f length")

  local v = string.unpack("<f", s)
  -- float has less precision; allow small epsilon
  local diff = v - 1.0

  if diff < 0 then diff = -diff end
  assert(diff < 1e-6, "unpack f ~= 1.0")

  local s2 = string.pack("<d", 3.14)
  local v2 = string.unpack("<d", s2)
  local diff2 = v2 - 3.14

  if diff2 < 0 then diff2 = -diff2 end
  assert(diff2 < 1e-12, "unpack d ~= 3.14")
end

-- fixed-length string (c)
do
  local s = string.pack("c5", "hello")
  assertEquals(#s, 5, "pack c5 length")

  local v, _ = string.unpack("c5", s)
  assertEquals(v, "hello", "unpack c5")

  -- shorter string: rest is zero-padded
  local s2 = string.pack("c5", "hi")
  assertEquals(#s2, 5, "pack c5 short length")

  local v2, _ = string.unpack("c5", s2)
  assertEquals(v2:sub(1,2), "hi", "unpack c5 short prefix")
end

-- length-prefixed string (s)
do
  local s = string.pack("<s4", "world")
  assertEquals(#s, 4 + 5, "pack s4 length")

  local v, nxt = string.unpack("<s4", s)
  assertEquals(v, "world", "unpack s4 value")
  assertEquals(nxt, #s + 1, "unpack s4 next pos")
end

-- zero-terminated string (z)
do
  local s = string.pack("z", "lua")
  assertEquals(#s, 4, "pack z length (with null)")
  assertEquals(s:byte(4), 0, "pack z null terminator")

  local v, nxt = string.unpack("z", s)
  assertEquals(v, "lua", "unpack z value")
  assertEquals(nxt, 5, "unpack z next pos")

  -- z with embedded zero must error
  assertError(
    function()
      string.pack("z", "a" .. string.char(0) .. "b")
    end,
    "z embedded zero"
  )
end

-- multiple values and next-position return
do
  local s = string.pack("<i2i2", 10, 20)
  assertEquals(#s, 4, "pack <i2i2 length")

  local a, b, nxt = string.unpack("<i2i2", s)
  assertEquals(a,   10, "unpack multi a")
  assertEquals(b,   20, "unpack multi b")
  assertEquals(nxt,  5, "unpack multi next pos")
end

-- init (offset) argument of unpack
do
  local s = string.pack("<i2i2", 100, 200)

  -- skip first field by starting at byte 3
  local v, nxt = string.unpack("<i2", s, 3)
  assertEquals(v, 200, "unpack with init")
  assertEquals(nxt, 5, "unpack with init next pos")
end

-- padding (x) and alignment
do
  local s = string.pack("bxi2", 1, 1000)
  -- 1 byte b + 1 byte pad + 2 bytes i2 = 4
  assertEquals(#s, 4, "pack bxi2 length")

  local a, b, _ = string.unpack("bxi2", s)
  assertEquals(a, 1, "unpack bxi2 b")
  assertEquals(b, 1000, "unpack bxi2 i2")
end

-- endianness switch inside format
do
  local s = string.pack("<I2>I2", 0x0102, 0x0304)
  -- little: 02 01; big: 03 04
  assertEquals(s:byte(1), 0x02, "LE low byte")
  assertEquals(s:byte(2), 0x01, "LE high byte")
  assertEquals(s:byte(3), 0x03, "BE high byte")
  assertEquals(s:byte(4), 0x04, "BE low byte")
end
