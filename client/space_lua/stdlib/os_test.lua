local function assertEquals(a, b)
    if a ~= b then
        error("Assertion failed: " .. tostring(a) .. " ~= " .. tostring(b))
    end
end

-- os.time basics
assert(os.time() > 0)

-- os.difftime
local t = os.time()
assert(os.difftime(t + 10, t) == 10)
assert(os.difftime(t, t + 10) == -10)
assert(os.difftime(t, t) == 0)

-- os.date default format (no args) returns a string
assert(type(os.date()) == "string")

-- Empty format returns empty string
assertEquals(os.date(""), "")

-- "!" alone returns empty string
assertEquals(os.date("!"), "")

-- Literal %%
assertEquals(os.date("%%"), "%")
assertEquals(os.date("%%%%"), "%%")

-- Reference time: 2006-01-02 15:04:05 UTC (Go reference time)
-- All fields are distinct: Y=2006 m=01 d=02 H=15 M=04 S=05 wday=Mon
local ts = 1136214245

-- Basic date specifiers (UTC)
assertEquals(os.date("!%Y", ts), "2006")
assertEquals(os.date("!%m", ts), "01")
assertEquals(os.date("!%d", ts), "02")
assertEquals(os.date("!%H", ts), "15")
assertEquals(os.date("!%M", ts), "04")
assertEquals(os.date("!%S", ts), "05")

-- %y (2-digit year)
assertEquals(os.date("!%y", ts), "06")

-- %C (century)
assertEquals(os.date("!%C", ts), "20")

-- %I (12-hour clock): 15 -> 03
assertEquals(os.date("!%I", ts), "03")

-- %p (AM/PM): hour 15 -> PM
assertEquals(os.date("!%p", ts), "PM")

-- AM case: 2006-01-02 03:04:05 UTC = ts - 12*3600
local ts_am = ts - 12 * 3600
assertEquals(os.date("!%p", ts_am), "AM")
assertEquals(os.date("!%I", ts_am), "03")
assertEquals(os.date("!%H", ts_am), "03")

-- %w (weekday, 0=Sunday..6=Saturday); 2006-01-02 is Monday=1
assertEquals(os.date("!%w", ts), "1")

-- %u (weekday, 1=Monday..7=Sunday); Monday=1
assertEquals(os.date("!%u", ts), "1")

-- Sunday: 2006-01-01 is Sunday
local ts_sun = ts - 86400
assertEquals(os.date("!%w", ts_sun), "0")
assertEquals(os.date("!%u", ts_sun), "7")

-- %j (day of year, 001-366); Jan 2 = 002
assertEquals(os.date("!%j", ts), "002")

-- %e (day of month, space-padded); 2 -> " 2"
assertEquals(os.date("!%e", ts), " 2")

-- Composite: %F (ISO date)
assertEquals(os.date("!%F", ts), "2006-01-02")

-- Composite: %D (MM/DD/YY)
assertEquals(os.date("!%D", ts), "01/02/06")

-- Composite: %T (HH:MM:SS)
assertEquals(os.date("!%T", ts), "15:04:05")

-- Composite: %R (HH:MM)
assertEquals(os.date("!%R", ts), "15:04")

-- Composite: %r (12-hour with AM/PM)
assertEquals(os.date("!%r", ts), "03:04:05 PM")

-- %n and %t
assertEquals(os.date("!%n"), "\n")
assertEquals(os.date("!%t"), "\t")

-- %s (epoch seconds)
--
-- Note: POSIX extension; comment out to run with standard Lua
-- interpreters.
assertEquals(os.date("!%s", ts), "1136214245")

-- %z and %Z in UTC/GMT mode
--
-- Note: Uncomment the "GMT" variant to run with standard Lua interpreter
-- and comment out the "UTC" variant.
assertEquals(os.date("!%z", ts), "+0000")
--assertEquals(os.date("!%Z", ts), "GMT") -- on most platforms
assertEquals(os.date("!%Z", ts), "UTC") -- in Space Lua

-- %h is alias for %b
assertEquals(os.date("!%h", ts), os.date("!%b", ts))

-- Multiple specifiers combined
assertEquals(os.date("!%Y-%m-%d %H:%M:%S", ts), "2006-01-02 15:04:05")

-- Plain text mixed with specifiers
assertEquals(os.date("!year=%Y", ts), "year=2006")

-- *t table (UTC)
local dt = os.date("!*t", ts)
assertEquals(dt.year, 2006)
assertEquals(dt.month, 1)
assertEquals(dt.day, 2)
assertEquals(dt.hour, 15)
assertEquals(dt.min, 4)
assertEquals(dt.sec, 5)
assertEquals(dt.wday, 2) -- Monday; Lua: 1=Sunday, so Monday=2
assertEquals(dt.yday, 2)

-- *t table (local time) has isdst field
local dt_local = os.date("*t", ts)
assert(type(dt_local.isdst) == "boolean")

-- UTC *t should not have isdst
assert(not dt.isdst)

-- %G/%g (ISO week-based year)
-- 2006-01-02 is in ISO week 1 of 2006
assertEquals(os.date("!%G", ts), "2006")
assertEquals(os.date("!%g", ts), "06")

-- ISO week-year boundary: 2005-01-01 (Saturday) is in ISO week 53 of 2004
local ts_2005 = 1104537600  -- 2005-01-01 00:00:00 UTC
assertEquals(os.date("!%G", ts_2005), "2004")
assertEquals(os.date("!%V", ts_2005), "53")

-- Week number specifiers at reference time (2006-01-02, Monday)
-- %U (weeks starting Sunday): Jan 1 is Sunday -> week 01, Jan 2 still week 01
assertEquals(os.date("!%U", ts), "01")
-- %W (weeks starting Monday): Jan 2 is first Monday -> week 01
assertEquals(os.date("!%W", ts), "01")
-- %V (ISO week): week 01
assertEquals(os.date("!%V", ts), "01")

-- Preserved original week tests
assertEquals(
    os.date("%Y-%m-%d", os.time({ year = 2020, month = 1, day = 1 })),
    "2020-01-01"
)
assertEquals(
    os.date("%Y-%m-%d", os.time({ year = 2025, month = 2, day = 3 })),
    "2025-02-03"
)

-- Invalid specifier throws error
local ok, err = pcall(os.date, "%Q")
assert(not ok)
assert(type(err) == "string")

-- Repeated specifiers
assertEquals(os.date("!%Y%Y", ts), "20062006")

-- os.getenv
-- Non-existent variable returns nil
assert(os.getenv("NONEXISTENT_VARIABLE_12345") == nil)

-- No argument returns nil
assert(os.getenv() == nil)
