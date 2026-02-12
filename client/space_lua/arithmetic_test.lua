local function assertEquals(actual, expected, message)
  if actual ~= expected then
    error('Assertion failed: ' .. message)
  end
end

local function assertThrows(msg_substr, fn)
  local ok, err = pcall(fn)

  if ok then
    error('Assertion failed: expected error containing "'
      .. msg_substr .. '"')
  end

  if type(err) ~= 'string' then
    err = tostring(err)
  end

  if not string.find(err, msg_substr, 1, true) then
    error('Assertion failed: expected error message to contain "'
      .. msg_substr .. '", got: "' .. err .. '"')
  end
end

-- 1. Integer vs float zero divisors

-- 1.1. Integer zeros collapse (no -0 for integers)
assertEquals(1/0 == 1/-0, true, 'int: 1/0 == 1/-0 (+Inf)')
assertEquals(-1/0 == 1/-0, false, 'int: -1/0 != 1/-0')

-- 1.2. Float zeros sign preservation
assertEquals(1/0.0 == 1/-0.0, false, 'float: +Inf != -Inf')
assertEquals(1/0.0 == -1/-0.0, true, 'float: 1/0.0 == -1/-0.0')
assertEquals(-1/0.0 == 1/-0.0, true, 'float: -1/0.0 == 1/-0.0')

-- 1.3. Basic division
assertEquals(5/2, 2.5, 'div: 5/2 == 2.5')
assertEquals(-5/2, -2.5, 'div: -5/2 == -2.5')
assertEquals(5/-2, -2.5, 'div: 5/-2 == -2.5')
assertEquals(-5/-2, 2.5, 'div: -5/-2 == 2.5')

-- 2. Unary minus literals and simple expressions
assertEquals(1/-(0) == 1/0, true, 'unary minus: int literal (+Inf)')
assertEquals(1/-(0.0) == -1/0.0, true, 'unary minus: float literal (-Inf)')
assertEquals(1/-(1-1) == 1/0, true, 'unary minus: int expr (+Inf)')
assertEquals(1/-(1.0-1.0) == -1/0.0, true, 'unary minus: float expr (-Inf)')

-- 2.1. Unary minus coercion and precedence with power
assertEquals(-2^2, -4, 'precedence: -2^2 == -(2^2)')
assertEquals((-2)^2, 4, 'precedence: (-2)^2 == 4')

-- 2.1.1. Unary minus with float-typed exponentiation results
do
  local function mt(x)
    return math.type(x)
  end

  assertEquals(mt(-("1.0" ^ 1)), "float", "math.type(-('1.0'^1)) => float")
  assertEquals(mt(-"1.0" ^ 1), "float", "math.type(-'1.0'^1) => float")
  assertEquals(mt(-("2.0" ^ 1)), "float", "math.type(-('2.0'^1)) => float")
  assertEquals(mt(-("2.0" ^ 2)), "float", "math.type(-('2.0'^2)) => float")
end

-- 2.2. Unary minus uses table metadata for dynamic keys
local dyn_tbl = {}
local dyn_key = 'zf'
dyn_tbl[dyn_key] = 0.0
assertEquals(1/-(dyn_tbl[dyn_key]) == -1/0.0, true, 'unary minus: table dyn key float (-Inf)')

-- 2.3. Unary minus uses table metadata for property access
local prop_tbl = { zf = 0.0, zi = 0 }
assertEquals(1/-(prop_tbl.zf) == -1/0.0, true, 'unary minus: table prop float (-Inf)')
assertEquals(1/-(prop_tbl.zi) == 1/0, true, 'unary minus: table prop int (+Inf)')

-- 2.4. Unary minus uses env metadata for locals
local u_zi, u_zf, u_zfn = 0, 0.0, -0.0
assertEquals(1/-(u_zi) == 1/0, true, 'var: unary minus zi (+Inf)')
assertEquals(1/-(u_zfn) == 1/0.0, true, 'var: unary minus zfn (+Inf)')
assertEquals(1/u_zf == 1/0.0, true, 'var: zf (+Inf)')

-- 3. Integer operations (must not produce -0)
assertEquals(1/(1-1) == 1/0, true, 'int: sub (+0)')
assertEquals(1/(0*-1) == 1/0, true, 'int: mul (+0)')
assertEquals(1/(0%1) == 1/0, true, 'int: mod (+0)')
assertEquals(1/(0%-1) == 1/0, true, 'int: mod neg divisor (+0)')

-- 4. Float operations (must preserve -0.0)
assertEquals(1/(0.0*-1.0) == -1/ 0.0, true, 'float: mul (-0.0)')
assertEquals(1/((-0.0)%1.0) == -1/ 0.0, true, 'float: mod (-0.0)')
assertEquals(1/((-0.0)%-1.0) == -1/ 0.0, true, 'float: mod neg divisor (-0.0)')

-- 4.1. Zero result from float addition prefers +0.0
assertEquals(1/((-0.0)+0.0) == 1/0.0, true, 'float: (-0.0)+0.0 yields +0.0')

-- 4.2. Plain -0.0 handling in arithmetic
do
  local nz = -0.0
  -- Addition: -0.0 + 0 yields +0.0 (IEEE 754 rule)
  assertEquals(1/(nz + 0), 1/0.0, 'plain -0.0: nz + 0 yields +0.0')
  assertEquals(1/(0 + nz), 1/0.0, 'plain -0.0: 0 + nz yields +0.0')

  -- Multiplication preserves -0.0
  assertEquals(1/(nz * 1), -1/0.0, 'plain -0.0: nz * 1 yields -0.0')
  assertEquals(1/(1 * nz), -1/0.0, 'plain -0.0: 1 * nz yields -0.0')

  -- Subtraction: -0.0 - 0 = -0.0
  assertEquals(1/(nz - 0), 1/0.0, 'plain -0.0: nz - 0 yields +0.0')

  -- Subtraction: -0.0 - 0.0 = -0.0 (float)
  assertEquals(1/(nz - 0.0), -1/0.0, 'plain -0.0: nz - 0.0 yields -0.0')

  -- Subtraction: 0 - (-0.0) = +0.0
  assertEquals(1/(0 - nz), 1/0.0, 'plain -0.0: 0 - nz yields +0.0')
end

-- 4.3. Expression-generated -0.0
do
  local r = 0.0 * -1.0
  assertEquals(1/r, -1/0.0, 'expr: 0.0 * -1.0 yields -0.0')

  local s = -1.0 * 0.0
  assertEquals(1/s, -1/0.0, 'expr: -1.0 * 0.0 yields -0.0')

  -- Division producing -0.0
  local d = -0.0 / 1.0
  assertEquals(1/d, -1/0.0, 'expr: -0.0 / 1.0 yields -0.0')
end

-- 5. Mixed arithmetic producing zero
assertEquals(1/(0*-1.0) == -1/0.0, true, 'mixed: mul int*float (-0.0)')
assertEquals(1/(0.0*-1 ) == -1/0.0, true, 'mixed: mul float*int (-0.0)')
assertEquals(1/(1.0+(-1)) == 1/0.0, true, 'mixed: add (+0.0)')
assertEquals(1/(-(1-1.0)) == -1/0.0, true, 'mixed: sub then unary minus (-0.0)')

-- 5.1. Dynamic key table metadata affects binary ops
local dyn_t, dyn_k = {}, 'zf'
dyn_t[dyn_k] = 0.0
assertEquals(1/dyn_t[dyn_k] == 1/0.0, true, 'binary: table dyn key float (+Inf)')

-- 6. Variables
local zi, zf, zfn = 0, 0.0, -0.0

assertEquals(1/zi == 1/0, true, 'var: zi (+Inf)')
assertEquals(1/zf == 1/0.0, true, 'var: zf (+Inf)')
assertEquals(1/zfn == -1/0.0, true, 'var: zfn (-Inf)')
assertEquals(1/-(zi) == 1/0, true, 'var: unary minus zi (+Inf)')
assertEquals(1/-(zfn) == 1/0.0, true, 'var: unary minus zfn (+Inf)')

-- 6.1. Variables: metadata must flow through reassignment
local zswap = 0.0
assertEquals(1/zswap == 1/0.0, true, 'var: zswap float (+Inf)')
zswap = 0
assertEquals(1/zswap == 1/0, true, 'var: zswap reassigned int (+Inf)')
zswap = 0.0
assertEquals(1/zswap == 1/0.0, true, 'var: zswap reassigned float (+Inf)')

-- 7. Functions returning zeros and unary minus
local function ret_zi()
  return 0
end

local function ret_zf()
  return 0.0
end

local function ret_zfn()
  return -0.0
end

assertEquals(1/ret_zi() == 1/0, true, 'fn: ret_zi (+Inf)')
assertEquals(1/ret_zf() == 1/0.0, true, 'fn: ret_zf (+Inf)')
assertEquals(1/ret_zfn() == -1/0.0, true, 'fn: ret_zfn (-Inf)')

assertEquals(1/-(ret_zi()) == 1/0, true, 'fn unary minus: ret_zi (+Inf)')
assertEquals(1/-(ret_zf()) == -1/0.0, true, 'fn unary minus: ret_zf (-Inf)')
assertEquals(1/-(ret_zfn()) == 1/0.0, true, 'fn unary minus: ret_zfn (+Inf)')

-- 8. Tables and arrays
local t, arr = {zi=zi, zfn=zfn}, {zi, zfn}

-- 8.1. Tables
assertEquals(1/t.zi == 1/0, true, 'table: t.zi (+Inf)')
assertEquals(1/t.zfn == -1/0.0, true, 'table: t.zfn (-Inf)')

-- 8.2. Arrays
assertEquals(1/arr[1] == 1/0, true, 'array: arr[1]=zi (+Inf)')
assertEquals(1/arr[2] == -1/0.0, true, 'array: arr[2]=zfn (-Inf)')

-- 8.3. Arrays: dynamic numeric index key metadata
local arr2 = {}
local idx = 1
arr2[idx] = 0.0
assertEquals(1/arr2[idx] == 1/0.0, true, 'array: dyn index float (+Inf)')

-- 9. Deeply nested parentheses and expressions
local xi, xf = 1-1, 1.0-1.0
local deepi = -((((0+0)-(1-1))+(zi-xi))) -- int path (+0)
local deepf = -((((0.0+0.0)-(1.0-1.0))+(zf-xf))) -- float path (-0.0)

assertEquals(1/deepi == 1/0, true, 'nested: int (+Inf)')
assertEquals(1/deepf == -1/0.0, true, 'nested: float (-Inf)')

-- 10. Floor division near zero
assertEquals(1/(0//1) == 1/0, true, 'floor div: int (+0)')
assertEquals(1/(0.0//1.0) == 1/0.0, true, 'floor div: float (+Inf)')
assertEquals(1/((-0.0)//1.0) == -1/0.0, true, 'floor div: float (-Inf)')
assertEquals(1/(0//1.0) == 1/0.0, true, 'floor div: mixed (+0.0)')

-- 10.1. Modulo/division identity
local function id_ok(a, b)
  return a == b * (a // b) + a % b
end

assertEquals(id_ok(5, 2), true, 'identity: 5, 2')
assertEquals(id_ok(-5, 2), true, 'identity: -5, 2')
assertEquals(id_ok(5, -2), true, 'identity: 5, -2')
assertEquals(id_ok(-5, -2), true, 'identity: -5, -2')

-- 10.2. Floor division signs
assertEquals(5//-2, -3, 'idiv: 5//-2 == -3')
assertEquals(-5//2, -3, 'idiv: -5//2 == -3')
assertEquals(-5//-2, 2, 'idiv: -5//-2 == 2')

-- 11. Ordering and NaN
assertEquals((-0.0) < (0.0), false, 'ordering: -0.0 < 0.0 is false')
assertEquals((0.0) < (-0.0), false, 'ordering: 0.0 < -0.0 is false')
assertEquals((-0.0) <= (0.0), true, 'ordering: -0.0 <= 0.0')
assertEquals((0.0) <= (-0.0), true, 'ordering: 0.0 <= -0.0')
assertEquals((0/0) == (0/0), false, 'NaN: never equals itself')

-- 12. Bitwise operators
assertEquals((~0) == -1, true, 'bitwise not on int ok')

val = pcall(
  function()
    return ~0.0
  end
)
assertEquals(val, true, 'bitwise not on float ok')

val = pcall(
  function()
    return 0<<1
  end
)
assertEquals(val, true, 'shl int ok')

val = pcall(
  function()
    return 0.0<<1
  end
)
assertEquals(val, true, 'shl float ok')

-- 12.1 Bitwise ops results
assertEquals((5&3) == 1, true, 'bitwise and result')
assertEquals((5|2) == 7, true, 'bitwise or result')
assertEquals((5~1) == 4, true, 'bitwise xor result')
assertEquals((1<<5) == 32, true, 'bitwise shl result')
assertEquals((32>>5) == 1, true, 'bitwise shr result')

-- 12.2 Bitwise with float values
assertEquals((~(-0.0)) == -1, true, 'bitwise not on -0.0 == -1')

-- 13. Evaluation order (left-to-right) for binary ops
local log, val

-- arithmetic + - * /
local function lhs_num()
  log[#log + 1] = 'L'
  return 1
end

local function rhs_num()
  log[#log + 1] = 'R'
  return 2
end

log = {}
val = lhs_num()+rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: +')

log = {}
val = lhs_num()-rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: -')

log = {}
val = lhs_num()*rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: *')

log = {}
val = lhs_num()/rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: /')

-- floor div and mod
log = {}
val = lhs_num()//rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: //')

log = {}
val = lhs_num()%rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: %')

-- power and concatenation
log = {}
val = lhs_num()^rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: ^')

local function lhs_str()
  log[#log + 1] = 'L'
  return 'a'
end

local function rhs_str()
  log[#log + 1] = 'R'
  return 'b'
end

log = {}
val = lhs_str()..rhs_str()
assertEquals(table.concat(log, ''), 'LR', 'order: ..')

-- relational
log = {}
val = (lhs_num() < rhs_num())
assertEquals(table.concat(log, ''), 'LR', 'order: <')

log = {}
val = (lhs_num() <= rhs_num())
assertEquals(table.concat(log, ''), 'LR', 'order: <=')

log = {}
val = (lhs_num() > rhs_num())
assertEquals(table.concat(log, ''), 'LR', 'order: >')

log = {}
val = (lhs_num() >= rhs_num())
assertEquals(table.concat(log, ''), 'LR', 'order: >=')

log = {}
val = (lhs_num() == rhs_num())
assertEquals(table.concat(log, ''), 'LR', 'order: ==')

log = {}
val = (lhs_num() ~= rhs_num())
assertEquals(table.concat(log, ''), 'LR', 'order: ~=')

-- bitwise
log = {}
val = lhs_num()&rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: &')

log = {}
val = lhs_num()|rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: |')

log = {}
val = lhs_num()~rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: ~ (xor)')

log = {}
val = lhs_num()<<rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: <<')

log = {}
val = lhs_num()>>rhs_num()
assertEquals(table.concat(log, ''), 'LR', 'order: >>')

-- 13.2. Nested expressions and associativity
local function exp_a()
  log[#log + 1] = 'A'
  return 2
end

local function exp_b()
  log[#log + 1] = 'B'
  return 3
end

local function exp_c()
  log[#log + 1] = 'C'
  return 2
end

log = {}
val = exp_a() ^ (exp_b() ^ exp_c())
assertEquals(val, 512, 'nested expression result')
assertEquals(table.concat(log, ''), 'ABC', 'nested expression associativity')

assertEquals(2^3^2, 512, 'power associativity')

-- 14. String-to-number coercion around zero
assertEquals(1/('0') == 1/0.0, true, 'str: ("0") (+Inf)')
assertEquals(1/('-0') == 1/0.0, true, 'str: ("-0") (+Inf)')
assertEquals(1/('0.0') == 1/0.0, true, 'str: ("0.0") (+Inf)')
assertEquals(1/('-0.0') == -1/0.0, true, 'str: ("-0.0") (-Inf)')
assertEquals(1/-('0') == 1/0.0, true, 'str: unary minus -("0") (+Inf)')
assertEquals(1/-('-0') == 1/0.0, true, 'str: unary minus -("-0") (+Inf)')

-- 14.1. General arithmetic with numeric strings
assertEquals('1'+2, 3, 'str-num: "1"+2 == 3')
assertEquals(' -2 ' * '3', -6, 'str-num: " -2 " * "3" == -6')
assertEquals('0x10' + 1, 17, 'str-num: hex int string + 1 == 17')
assertEquals('0x1p4' + 0, 16, 'str-num: hex float string + 0 == 16')
assertThrows("attempt to add a 'string' with a 'number'",
  function()
    return 'x1'+1
  end
)

-- 14.2 Numeric string coercion preserves int/float kind
do
  local function mt(x)
    return math.type(x)
  end

  assertEquals(mt("0" + 0), "integer", "string '0' + 0 => integer")
  assertEquals(mt("-0" + 0), "integer", "string '-0' + 0 => integer")

  assertEquals(mt("0.0" + 0), "float", "string '0.0' + 0 => float")
  assertEquals(mt("-0.0" + 0), "float", "string '-0.0' + 0 => float")

  assertEquals(mt("0" + 0.0), "float", "string '0' + 0.0 => float")
  assertEquals(mt("0.0" + 0.0), "float", "string '0.0' + 0.0 => float")

  assertEquals(mt("0" + -0), "integer", "string '0' + -0 => integer")
  assertEquals(mt("0" + -0.0), "float", "string '0' + -0.0 => float")

  -- Regression coverage: numeric strings for all arithmetic ops and operand order
  assertEquals(mt("0" - 0), "integer", "string '0' - 0 => integer")
  assertEquals(mt("0.0" - 0), "float", "string '0.0' - 0 => float")
  assertEquals(mt("0" * 1), "integer", "string '0' * 1 => integer")
  assertEquals(mt("0.0" * 1), "float", "string '0.0' * 1 => float")
  assertEquals(mt("0" / 1), "float", "string '0' / 1 => float")
  assertEquals(mt("0.0" / 1), "float", "string '0.0' / 1 => float")
  assertEquals(mt("0" // 1), "integer", "string '0' // 1 => integer")
  assertEquals(mt("0.0" // 1), "float", "string '0.0' // 1 => float")
  assertEquals(mt("0" % 1), "integer", "string '0' % 1 => integer")
  assertEquals(mt("0.0" % 1), "float", "string '0.0' % 1 => float")
  assertEquals(mt("2" ^ 1), "float", "string '2' ^ 1 => float")
  assertEquals(mt("2.0" ^ 1), "float", "string '2.0' ^ 1 => float")

  assertEquals(mt(0 + "0"), "integer", "0 + string '0' => integer")
  assertEquals(mt(0 + "0.0"), "float", "0 + string '0.0' => float")

  assertEquals(mt(0 - "0"), "integer", "0 - string '0' => integer")
  assertEquals(mt(0 - "0.0"), "float", "0 - string '0.0' => float")

  assertEquals(mt(1 * "0"), "integer", "1 * string '0' => integer")
  assertEquals(mt(1 * "0.0"), "float", "1 * string '0.0' => float")

  assertEquals(mt(0 / "1"), "float", "0 / string '1' => float")
  assertEquals(mt(0 / "1.0"), "float", "0 / string '1.0' => float")

  assertEquals(mt(0 // "1"), "integer", "0 // string '1' => integer")
  assertEquals(mt(0 // "1.0"), "float", "0 // string '1.0' => float")

  assertEquals(mt(0 % "1"), "integer", "0 % string '1' => integer")
  assertEquals(mt(0 % "1.0"), "float", "0 % string '1.0' => float")

  assertEquals(mt(2 ^ "1"), "float", "2 ^ string '1' => float")
  assertEquals(mt(2 ^ "1.0"), "float", "2 ^ string '1.0' => float")

  assertEquals((1 // "2"), 0, "1 // '2' == 0")
  assertEquals((1 // "2.0"), 0.0, "1 // '2.0' == 0.0")
end

-- 15. Recursive function producing int zero (and unary minus)
local function rec_zero(n)
  if n == 0 then
    return 0
  end
  return -rec_zero(n - 1)
end

assertEquals(1/rec_zero(5) == 1/0, true, 'recursive: rec_zero (+Inf)')
assertEquals(1/(rec_zero(5)) == 1/0, true, 'recursive: (rec_zero) (+Inf)')
assertEquals(1/-(rec_zero(5)) == 1/0, true, 'recursive: -(rec_zero) (+Inf)')
assertEquals(1/-rec_zero(5) == 1/0, true, 'recursive: -(rec_zero) (+Inf)')

-- 16. Modulo and integer division by zero

-- 16.1. Modulo by zero
assertThrows("attempt to perform 'n%0'",
  function()
    return 1%0
  end
)

val = pcall(
  function()
    return 1.0%0.0
  end
)
assertEquals(val, true, 'float mod by zero ok (NaN)')

val = pcall(
  function()
    return 1.0%0
  end
)
assertEquals(val, true, 'mixed (float,int) mod by zero ok (NaN)')

val = pcall(
  function()
    return 1%0.0
  end
)
assertEquals(val, true, 'mixed (int,float) mod by zero ok (NaN)')

-- 16.2. Integer division by zero
assertThrows('divide by zero',
  function()
    return 1//0
  end
)

val = pcall(
  function()
    return 1.0//0.0
  end
)
assertEquals(val, true, 'float idiv by zero ok (+Inf/-Inf)')

val = pcall(
  function()
    return 1.0//0
  end
)
assertEquals(val, true, 'mixed (float,int) idiv by zero ok (+Inf/-Inf)')

val = pcall(
  function()
    return 1//0.0
  end
)
assertEquals(val, true, 'mixed (int,float) idiv by zero ok (+Inf/-Inf)')

-- 16.3. Modulo sign semantics (explicit)
assertEquals(5 % -2, -1, 'mod: 5 % -2 == -1')
assertEquals(-5 % 2, 1, 'mod: -5 % 2 == 1')
assertEquals(-5 % -2, -1, 'mod: -5 % -2 == -1')

-- 17. Metamethod precedence: __add should dispatch
local mt = {
  __add = function(_, _)
    return 'added'
  end
}
local tbl = setmetatable({}, mt)

assertEquals(tbl + tbl, 'added', '__add dispatched')

-- 17.1 Unary metamethod: __unm (negation)
local mt_unm = {
  __unm = function(_)
    return 'negated'
  end
}
local u = setmetatable({}, mt_unm)

assertEquals(-u, 'negated', '__unm dispatched')

-- 17.2 Unary metamethod: __bnot (bitwise NOT)
local bnot_calls = 0
local mt_bnot = {
  __bnot = function(_)
    bnot_calls = bnot_calls + 1
    return 123
  end
}
local b = setmetatable({}, mt_bnot)

assertEquals(~b, 123, '__bnot dispatched')
assertEquals(bnot_calls, 1, '__bnot called exactly once')

-- 17.3. Unary metamethods multi-return (first return only)
local mt_unm_mr = {
  __unm = function(_)
    return 7, 8
  end
}
local um = setmetatable({}, mt_unm_mr)

assertEquals(-um, 7, '__unm uses first return value')

local mt_bnot_mr = {
  __bnot = function(_)
    return 9, 10
  end
}
local bm = setmetatable({}, mt_bnot_mr)

assertEquals(~bm, 9, '__bnot uses first return value')

-- 18. Multi-return in arithmetic (first return only)
local function multi_ret()
  return 0, 1
end

assertEquals(1/(multi_ret()) == 1/0, true, 'multi-ret: 1st used (+Inf)')
assertEquals(1/-(multi_ret()) == 1/0, true, 'multi-ret: unary minus 1st used (+Inf)')

-- 18.1 Exponentiation zero edge cases
assertEquals(0^0 == 1, true, 'pow: 0^0 == 1')
assertEquals((-0.0)^0 == 1, true, 'pow: (-0.0)^0 == 1')

-- 19. Error tests
assertThrows('has no integer representation',
  function()
    return ~0.5
  end
)

assertThrows("attempt to add a 'string' with a 'number'",
  function()
    return 'a'+1
  end
)

assertThrows('attempt to perform arithmetic on a table value',
  function()
    return -{}
  end
)

-- 19.1. Bitwise on non-integers should error
assertThrows('has no integer representation',
  function()
    return 1.5&1
  end
)

assertThrows(
  "attempt to perform bitwise operation on a string value (constant '3')",
  function()
    return '3'|1
  end
)

assertThrows('has no integer representation',
  function()
    return 1~1.2
  end
)

assertThrows('has no integer representation',
  function()
    return 1<<0.1
  end
)

-- 19.2. Relational type error
assertThrows('attempt to compare number with string',
  function()
    return 1<'1'
  end
)

-- 19.3. Additional negative tests
assertThrows('attempt to perform arithmetic on a table value',
  function()
    return 1+{}
  end
)

assertThrows("attempt to unm a 'string' with a 'string'",
  function()
    return -'x'
  end
)

assertThrows(
  "attempt to perform bitwise operation on a string value (constant '1')",
  function()
    return ~'1'
  end
)

assertThrows('attempt to compare string with number',
  function()
    return '1'<1
  end
)

assertThrows('attempt to compare number with table',
  function()
    return 1<{}
  end
)

-- 19.4. String arithmetic: exact verb mapping
assertThrows("attempt to sub a 'string' with a 'number'",
  function()
    return 'x' - 1
  end
)

assertThrows("attempt to mul a 'string' with a 'number'",
  function()
    return 'x' * 2
  end
)

assertThrows("attempt to div a 'string' with a 'number'",
  function()
    return 'x' / 2
  end
)

assertThrows("attempt to idiv a 'string' with a 'number'",
  function()
    return 'x' // 2
  end
)

assertThrows("attempt to mod a 'string' with a 'number'",
  function()
    return 'x' % 2
  end
)

assertThrows("attempt to pow a 'string' with a 'number'",
  function()
    return 'x' ^ 2
  end
)

-- 19.4.1. String arithmetic: type pairing and string-vs-string cases
assertThrows("attempt to add a 'string' with a 'string'",
  function()
    return 'x' + 'y'
  end
)

assertThrows("attempt to mul a 'number' with a 'string'",
  function()
    return 2 * 'x'
  end
)

-- 19.5. Bitwise: exact type errors
assertThrows("attempt to perform bitwise operation on a table value",
  function()
    return {} & 1
  end
)

assertThrows("attempt to perform bitwise operation on a nil value",
  function()
    return nil | 1
  end
)

assertThrows("attempt to perform bitwise operation on a boolean value",
  function()
    return true ~ 1
  end
)

-- 19.6. Bitwise shifts: non-integer RHS
assertThrows("number has no integer representation",
  function()
    return 1 << 0.5
  end
)

assertThrows("number has no integer representation",
  function()
    return 8 >> 0.25
  end
)

-- 19.7. Concatenation: exact messages
assertThrows("attempt to concatenate a nil value",
  function()
    return nil .. "x"
  end
)

assertThrows("attempt to concatenate a nil value",
  function()
    return "x" .. nil
  end
)

assertThrows("attempt to concatenate a table value",
  function()
    return "x" .. {}
  end
)

-- 19.8. Length operator: exact message
assertThrows("attempt to get length of a number value",
  function()
    return #1
  end
)

assertThrows("attempt to get length of a nil value",
  function()
    return #nil
  end
)

-- 19.9. Relational mismatches
assertThrows("attempt to compare number with string",
  function()
    return 1 <= '1'
  end
)

assertThrows("attempt to compare number with string",
  function()
    return '1' >= 1
  end
)

assertThrows("attempt to compare table with number",
  function()
    return 1 > {}
  end
)

assertThrows("attempt to compare table with number",
  function()
    return {} < 1
  end
)

-- 19.10. Explicit int-path division/modulo by zero through expr
assertThrows("attempt to perform 'n%0'",
  function()
    return 1 % (1-1)
  end
)

assertThrows("attempt to divide by zero",
  function()
    return 1 // (1-1)
  end
)

-- 20. `tostring()` numeric formatting

-- 20.1. Integers
assertEquals(tostring(0), '0', 'tostring: 0')
assertEquals(tostring(1), '1', 'tostring: 1')
assertEquals(tostring(-5), '-5', 'tostring: -5')
assertEquals(tostring(42), '42', 'tostring: 42')
assertEquals(tostring(-123), '-123', 'tostring: -123')

-- 20.2. Float zeros (positive and negative)
assertEquals(tostring(0.0), '0.0', 'tostring: 0.0')
assertEquals(tostring(-0.0), '-0.0', 'tostring: -0.0')

-- 20.3. Integer-valued floats
assertEquals(tostring(1.0), '1.0', 'tostring: 1.0')
assertEquals(tostring(2.0), '2.0', 'tostring: 2.0')
assertEquals(tostring(-3.0), '-3.0', 'tostring: -3.0')
assertEquals(tostring(100.0), '100.0', 'tostring: 100.0')

-- 20.4. Non-integer floats
assertEquals(tostring(0.5), '0.5', 'tostring: 0.5')
assertEquals(tostring(3.14), '3.14', 'tostring: 3.14')
assertEquals(tostring(-2.5), '-2.5', 'tostring: -2.5')

-- 20.5. Special float values
assertEquals(tostring(1/0.0), 'inf', 'tostring: +inf')
assertEquals(tostring(-1/0.0), '-inf', 'tostring: -inf')
assertEquals(tostring(0.0/0.0), '-nan', 'tostring: NaN')
assertEquals(tostring(1.0%0.0), '-nan', 'tostring: NaN from modulo')
assertEquals(tostring((-1.0)%0.0), '-nan', 'tostring: NaN from neg modulo')

-- 20.6. Results from tonumber() preserve type
assertEquals(tostring(tonumber('5')), '5', 'tonumber int: "5"')
assertEquals(tostring(tonumber('5.')), '5.0', 'tonumber float: "5."')
assertEquals(tostring(tonumber('.5')), '0.5', 'tonumber float: ".5"')
assertEquals(tostring(tonumber('5.0')), '5.0', 'tonumber float: "5.0"')
assertEquals(tostring(tonumber('0x10')), '16', 'tonumber hex int: "0x10"')
assertEquals(tostring(tonumber('0x10.0')), '16.0', 'tonumber hex float: "0x10.0"')
assertEquals(tostring(tonumber('0x1p4')), '16.0', 'tonumber hex float: "0x1p4"')

-- 20.7. Arithmetic results formatting
assertEquals(tostring(1+1), '2', 'int+int yields int')
assertEquals(tostring(1.0+1.0), '2.0', 'float+float yields float')
assertEquals(tostring(1+1.0), '2.0', 'int+float yields float')
assertEquals(tostring(5/2), '2.5', 'division yields float')
assertEquals(tostring(4/2), '2.0', 'division exact yields float')

-- 21. Numeric for loops: comprehensive type/mode coverage

-- 21.1. Integer mode (all params integer-valued and untagged)

do
  local types, vals = {}, {}
  for i = 1, 3 do
    table.insert(types, math.type(i))
    table.insert(vals, tostring(i))
  end
  assertEquals(table.concat(types, ','), 'integer,integer,integer', 'for 1,3: types')
  assertEquals(table.concat(vals, ','), '1,2,3', 'for 1,3: values')
end

do
  local types = {}
  for i = 1, 3, 1 do
    table.insert(types, math.type(i))
  end
  assertEquals(types[1], 'integer', 'for 1,3,1: type')
end

do
  local vals = {}
  for i = 3, 1, -1 do
    table.insert(vals, tostring(i))
  end
  assertEquals(table.concat(vals, ','), '3,2,1', 'for 3,1,-1: descending')
end

do
  local found_zero = false
  local zero_str
  for i = -1, 1 do
    if i == 0 then
      found_zero = true
      zero_str = tostring(i)
    end
  end
  assertEquals(found_zero, true, 'for -1,1: crosses zero')
  assertEquals(zero_str, '0', 'for -1,1: zero is int')
end

do
  for i = 1, 3 do
    local zero = i - i
    assertEquals(math.type(zero), 'integer', 'for 1,3: i-i is int')
    assertEquals(tostring(zero), '0', 'for 1,3: i-i formats as int')
  end
end

do
  for i = 2, 4 do
    local expr = i * 2 - i - i
    assertEquals(math.type(expr), 'integer', 'for 2,4: int expr is int')
    assertEquals(expr, 0, 'for 2,4: int expr value')
  end
end

-- 21.2. Float mode (all params float-typed)

do
  local types, vals = {}, {}
  for i = 1.0, 3.0, 1.0 do
    table.insert(types, math.type(i))
    table.insert(vals, tostring(i))
  end
  assertEquals(table.concat(types, ','), 'float,float,float', 'for 1.0,3.0,1.0: types')
  assertEquals(table.concat(vals, ','), '1.0,2.0,3.0', 'for 1.0,3.0,1.0: values')
end

do
  local vals = {}
  for i = 0.5, 2.5, 0.5 do
    table.insert(vals, tostring(i))
  end
  assertEquals(table.concat(vals, ','), '0.5,1.0,1.5,2.0,2.5', 'for 0.5,2.5,0.5: values')
end

do
  local vals = {}
  for i = 3.0, 1.0, -1.0 do
    table.insert(vals, tostring(i))
  end
  assertEquals(table.concat(vals, ','), '3.0,2.0,1.0', 'for 3.0,1.0,-1.0: descending')
end

do
  local vals = {}
  for i = 2.5, 0.5, -0.5 do
    table.insert(vals, tostring(i))
  end
  assertEquals(table.concat(vals, ','), '2.5,2.0,1.5,1.0,0.5', 'for 2.5,0.5,-0.5: values')
end

do
  local zero_str
  for i = -1.0, 1.0 do
    if i == 0 then
      zero_str = tostring(i)
    end
  end
  assertEquals(zero_str, '0.0', 'for -1.0,1.0: zero is float')
end

do
  for i = 1.0, 3.0 do
    local zero = i - i
    assertEquals(math.type(zero), 'float', 'for 1.0,3.0: i-i is float')
    assertEquals(tostring(zero), '0.0', 'for 1.0,3.0: i-i formats as float')
  end
end

do
  for i = 2.0, 4.0 do
    local expr = i * 2.0 - i - i
    assertEquals(math.type(expr), 'float', 'for 2.0,4.0: float expr is float')
    assertEquals(tostring(expr), '0.0', 'for 2.0,4.0: float expr formats')
  end
end

-- 21.3. Mixed mode (start type determines loop var type)

do
  local types, vals = {}, {}
  for i = 1, 3.5 do
    table.insert(types, math.type(i))
    table.insert(vals, tostring(i))
  end
  assertEquals(types[1], 'integer', 'for 1,3.5: start int yields var int')
  assertEquals(types[2], 'integer', 'for 1,3.5: var stays int')
  assertEquals(table.concat(vals, ','), '1,2,3', 'for 1,3.5: int formatting')
end

do
  local types, vals = {}, {}
  for i = 1.0, 3 do
    table.insert(types, math.type(i))
    table.insert(vals, tostring(i))
  end
  assertEquals(types[1], 'float', 'for 1.0,3: start float yields var float')
  assertEquals(types[2], 'float', 'for 1.0,3: var stays float')
  assertEquals(table.concat(vals, ','), '1.0,2.0,3.0', 'for 1.0,3: float formatting')
end

do
  local types = {}
  for i = 1, 3.0 do
    table.insert(types, math.type(i))
  end
  assertEquals(types[1], 'integer', 'for 1,3.0: end=3.0 but start int yields var int')
end

do
  local types, vals = {}, {}
  for i = 1, 3, 1.0 do
    table.insert(types, math.type(i))
    table.insert(vals, tostring(i))
  end
  assertEquals(types[1], 'float', 'for 1,3,1.0: step float yields var float')
  assertEquals(table.concat(vals, ','), '1.0,2.0,3.0', 'for 1,3,1.0: float formatting')
end

do
  local types, vals = {}, {}
  for i = 1.0, 3.0, 1 do
    table.insert(types, math.type(i))
    table.insert(vals, tostring(i))
  end
  assertEquals(types[1], 'float', 'for 1.0,3.0,1: start float yields var float')
  assertEquals(table.concat(vals, ','), '1.0,2.0,3.0', 'for 1.0,3.0,1: float formatting')
end

do
  local types = {}
  for i = 3.0, 1, -1 do
    table.insert(types, math.type(i))
  end
  assertEquals(types[1], 'float', 'for 3.0,1,-1: start float yields var float')
end

-- Mixed mode: float step, integer start
do
  local types, vals = {}, {}
  for i = 1, 3, 1.0 do
    table.insert(types, math.type(i))
    table.insert(vals, tostring(i))
  end
  assertEquals(types[1], 'float', 'for 1,3,1.0: step float yields var float')
  assertEquals(table.concat(vals, ','), '1.0,2.0,3.0', 'for 1,3,1.0: float formatting')
end

-- Mixed mode: integer start, negative float step
do
  local types, vals = {}, {}
  for i = 3, 1, -1.0 do
    table.insert(types, math.type(i))
    table.insert(vals, tostring(i))
  end
  assertEquals(types[1], 'float', 'for 3,1,-1.0: step float yields var float')
  assertEquals(table.concat(vals, ','), '3.0,2.0,1.0', 'for 3,1,-1.0: float formatting')
end

do
  for i = 1, 3.5 do
    local zero = i - i
    assertEquals(math.type(zero), 'integer', 'for 1,3.5: start int yields i-i is int')
  end
end

do
  for i = 1.0, 3 do
    local zero = i - i
    assertEquals(math.type(zero), 'float', 'for 1.0,3: start float yields i-i is float')
  end
end

-- 21.4. Boundary conditions

do
  local count = 0
  for i = 5, 5 do
    count = count + 1
    assertEquals(i, 5, 'for 5,5: i=5')
  end
  assertEquals(count, 1, 'for 5,5: one iteration')
end

do
  local count = 0
  for i = 5, 3 do
    count = count + 1
  end
  assertEquals(count, 0, 'for 5,3: no iterations')
end

do
  local count = 0
  for i = 3, 5, -1 do
    count = count + 1
  end
  assertEquals(count, 0, 'for 3,5,-1: no iterations')
end

do
  local last
  for i = 1.0, 3.0 do
    last = i
  end
  assertEquals(tostring(last), '3.0', 'for 1.0,3.0: exactly reaches end')
end

do
  local last
  for i = 1, 10, 3 do
    last = i
  end
  assertEquals(last, 10, 'for 1,10,3: reaches end exactly')
end

do
  local last
  for i = 1, 9, 3 do
    last = i
  end
  assertEquals(last, 7, 'for 1,9,3: stops before end')
end

do
  local vals = {}
  for i = 0.1, 0.3, 0.1 do
    table.insert(vals, i)
  end
  assertEquals(#vals, 2, 'for 0.1,0.3,0.1: small float step iterations')
end

do
  local vals = {}
  -- 0.5 has exact binary representation
  for i = 0.5, 1.5, 0.5 do
    table.insert(vals, i)
  end
  assertEquals(#vals, 3, 'for 0.5,1.5,0.5: small float step')
end

-- 21.5. Edge cases and errors

assertThrows('step is zero', function()
  for i = 1, 10, 0 do
  end
end)

assertThrows('step is zero', function()
  for i = 1.0, 10.0, 0.0 do
  end
end)

do
  local count = 0
  for i = 1, 1000000 do
    count = count + 1
    if count > 5 then break end
  end
  assertEquals(count, 6, 'for 1,1000000: large range with break')
end

do
  local sum = 0
  for i = 1, 5, 2 do
    sum = sum + i
  end
  assertEquals(sum, 9, 'for 1,5,2: step>1 sum (1+3+5)')
end

do
  local sum = 0
  for i = 10, 1, -3 do
    sum = sum + i
  end
  assertEquals(sum, 22, 'for 10,1,-3: negative step>1 sum (10+7+4+1)')
end

-- 22. Table numeric key equivalence

-- 22.1. Integer-valued floats normalize to integers

do
  local t = {}
  t[1] = 'one'
  assertEquals(t[1.0], 'one', 'table: t[1] accessed via t[1.0]')
  assertEquals(t[1], 'one', 'table: t[1] accessed via t[1]')
end

do
  local t = {}
  t[2.0] = 'two'
  assertEquals(t[2], 'two', 'table: t[2.0] accessed via t[2]')
  assertEquals(t[2.0], 'two', 'table: t[2.0] accessed via t[2.0]')
end

do
  local t = {}
  t[1] = 'a'
  t[2.0] = 'b'
  t[3] = 'c'
  assertEquals(t[1.0], 'a', 'table: multi-key t[1.0]')
  assertEquals(t[2], 'b', 'table: multi-key t[2]')
  assertEquals(t[3.0], 'c', 'table: multi-key t[3.0]')
end

do
  local t = {}
  t[5] = 'first'
  t[5.0] = 'second'
  assertEquals(t[5], 'second', 'table: overwrite int with float')
  assertEquals(t[5.0], 'second', 'table: overwrite int with float (access)')
end

do
  local t = {}
  t[100] = 'hundred'
  assertEquals(t[100.0], 'hundred', 'table: large int t[100.0]')
end

-- 22.2. Zero normalization (both -0 and +0 map to same key)

do
  local t = {}
  t[0] = 'zero'
  assertEquals(t[-0.0], 'zero', 'table: t[0] accessed via t[-0.0]')
  assertEquals(t[0.0], 'zero', 'table: t[0] accessed via t[0.0]')
  assertEquals(t[0], 'zero', 'table: t[0] accessed via t[0]')
end

do
  local t = {}
  t[-0.0] = 'negzero'
  assertEquals(t[0], 'negzero', 'table: t[-0.0] accessed via t[0]')
  assertEquals(t[0.0], 'negzero', 'table: t[-0.0] accessed via t[0.0]')
  assertEquals(t[-0.0], 'negzero', 'table: t[-0.0] accessed via t[-0.0]')
end

do
  local t = {}
  t[0.0] = 'float_zero'
  assertEquals(t[0], 'float_zero', 'table: t[0.0] accessed via t[0]')
  assertEquals(t[-0.0], 'float_zero', 'table: t[0.0] accessed via t[-0.0]')
end

do
  local t = {}
  t[0] = 'first'
  t[-0.0] = 'second'
  t[0.0] = 'third'
  assertEquals(t[0], 'third', 'table: zero overwrite final')
  assertEquals(t[-0.0], 'third', 'table: zero overwrite via -0.0')
end

-- 22.3. Non-integer floats are distinct keys

do
  local t = {}
  t[1] = 'int_one'
  t[1.5] = 'one_point_five'
  assertEquals(t[1], 'int_one', 'table: non-int float t[1]')
  assertEquals(t[1.5], 'one_point_five', 'table: non-int float t[1.5]')
  assertEquals(t[1.0], 'int_one', 'table: non-int float t[1.0] maps to int')
end

do
  local t = {}
  t[0.5] = 'half'
  t[1.5] = 'one_half'
  t[2.5] = 'two_half'
  assertEquals(t[0.5], 'half', 'table: multi non-int t[0.5]')
  assertEquals(t[1.5], 'one_half', 'table: multi non-int t[1.5]')
  assertEquals(t[2.5], 'two_half', 'table: multi non-int t[2.5]')
end

-- 22.4. Mixed integer and float keys

do
  local t = {}
  t[0] = 'zero'
  t[1] = 'one'
  t[1.5] = 'one_point_five'
  t[2.0] = 'two'
  t[-0.0] = 'neg_zero'

  assertEquals(t[0], 'neg_zero', 'table: mixed t[0] (last zero)')
  assertEquals(t[0.0], 'neg_zero', 'table: mixed t[0.0]')
  assertEquals(t[-0.0], 'neg_zero', 'table: mixed t[-0.0]')
  assertEquals(t[1], 'one', 'table: mixed t[1]')
  assertEquals(t[1.0], 'one', 'table: mixed t[1.0]')
  assertEquals(t[1.5], 'one_point_five', 'table: mixed t[1.5]')
  assertEquals(t[2], 'two', 'table: mixed t[2]')
  assertEquals(t[2.0], 'two', 'table: mixed t[2.0]')
end

-- 22.5. Key equivalence with expressions

do
  local t = {}
  t[1+1] = 'two'
  assertEquals(t[2.0], 'two', 'table: expr key t[1+1] via t[2.0]')
  assertEquals(t[4/2], 'two', 'table: expr key t[4/2]')
end

do
  local t = {}
  t[1-1] = 'int_zero'
  assertEquals(t[0], 'int_zero', 'table: expr t[1-1] via t[0]')
  assertEquals(t[0.0], 'int_zero', 'table: expr t[1-1] via t[0.0]')
  assertEquals(t[-0.0], 'int_zero', 'table: expr t[1-1] via t[-0.0]')
end

do
  local t = {}
  t[1.0-1.0] = 'float_zero'
  assertEquals(t[0], 'float_zero', 'table: expr t[1.0-1.0] via t[0]')
  assertEquals(t[-0.0], 'float_zero', 'table: expr t[1.0-1.0] via t[-0.0]')
end

-- 22.6. Key equivalence with variables

do
  local t = {}
  local i = 1
  local f = 1.0
  t[i] = 'from_int'
  assertEquals(t[f], 'from_int', 'table: var int key via float var')
end

do
  local t = {}
  local i = 1
  local f = 1.0
  t[f] = 'from_float'
  assertEquals(t[i], 'from_float', 'table: var float key via int var')
end

do
  local t = {}
  local zi = 0
  local zf = 0.0
  local zfn = -0.0
  t[zi] = 'int_zero'
  assertEquals(t[zf], 'int_zero', 'table: var zi via zf')
  assertEquals(t[zfn], 'int_zero', 'table: var zi via zfn')
end

-- 22.7. Key equivalence in array part

do
  local t = {10, 20, 30}
  assertEquals(t[1.0], 10, 'table: array t[1.0]')
  assertEquals(t[2.0], 20, 'table: array t[2.0]')
  assertEquals(t[3.0], 30, 'table: array t[3.0]')
end

do
  local t = {}
  t[1.0] = 'first'
  t[2.0] = 'second'
  assertEquals(t[1], 'first', 'table: array assign t[1.0] via t[1]')
  assertEquals(t[2], 'second', 'table: array assign t[2.0] via t[2]')
end

-- 22.8. Key counting and iteration

do
  local t = {}
  t[1] = 'a'
  t[1.0] = 'b'
  t[2] = 'c'
  t[2.0] = 'd'

  local count = 0
  for k, v in pairs(t) do
    count = count + 1
  end
  assertEquals(count, 2, 'table: normalized keys count as one')
end

do
  local t = {}
  t[0] = 'a'
  t[0.0] = 'b'
  t[-0.0] = 'c'

  local count = 0
  for k, v in pairs(t) do
    count = count + 1
  end
  assertEquals(count, 1, 'table: all zeros count as one key')
end

-- 23. Type introspection: type() and math.type()

-- 23.1. Basic type() function (returns general Lua types)

assertEquals(type(nil), 'nil', 'type(nil)')
assertEquals(type(true), 'boolean', 'type(true)')
assertEquals(type(false), 'boolean', 'type(false)')
assertEquals(type(0), 'number', 'type(0) is number')
assertEquals(type(1), 'number', 'type(1) is number')
assertEquals(type(0.0), 'number', 'type(0.0) is number')
assertEquals(type(1.0), 'number', 'type(1.0) is number')
assertEquals(type(-0.0), 'number', 'type(-0.0) is number')
assertEquals(type(1.5), 'number', 'type(1.5) is number')
assertEquals(type(1/0.0), 'number', 'type(inf) is number')
assertEquals(type(0.0/0.0), 'number', 'type(nan) is number')
assertEquals(type('hello'), 'string', 'type(string)')
assertEquals(type({}), 'table', 'type(table)')
assertEquals(type(function() end), 'function', 'type(function)')

-- 23.2. math.type() function (distinguishes integer vs float)

-- Integers
assertEquals(math.type(0), 'integer', 'math.type(0)')
assertEquals(math.type(1), 'integer', 'math.type(1)')
assertEquals(math.type(-1), 'integer', 'math.type(-1)')
assertEquals(math.type(42), 'integer', 'math.type(42)')
assertEquals(math.type(-123), 'integer', 'math.type(-123)')
assertEquals(math.type(1000000), 'integer', 'math.type(1000000)')

-- Floats (literals with decimal point)
assertEquals(math.type(0.0), 'float', 'math.type(0.0)')
assertEquals(math.type(-0.0), 'float', 'math.type(-0.0)')
assertEquals(math.type(1.0), 'float', 'math.type(1.0)')
assertEquals(math.type(2.0), 'float', 'math.type(2.0)')
assertEquals(math.type(-3.0), 'float', 'math.type(-3.0)')
assertEquals(math.type(100.0), 'float', 'math.type(100.0)')

-- Floats (non-integer values)
assertEquals(math.type(0.5), 'float', 'math.type(0.5)')
assertEquals(math.type(1.5), 'float', 'math.type(1.5)')
assertEquals(math.type(3.14), 'float', 'math.type(3.14)')
assertEquals(math.type(-2.5), 'float', 'math.type(-2.5)')

-- Special float values
assertEquals(math.type(1/0.0), 'float', 'math.type(inf)')
assertEquals(math.type(-1/0.0), 'float', 'math.type(-inf)')
assertEquals(math.type(0.0/0.0), 'float', 'math.type(nan)')

-- Non-numbers return nil
assertEquals(math.type(nil), nil, 'math.type(nil) yields nil')
assertEquals(math.type(true), nil, 'math.type(boolean) yields nil')
assertEquals(math.type('123'), nil, 'math.type(string) yields nil')
assertEquals(math.type({}), nil, 'math.type(table) yields nil')
assertEquals(math.type(function() end), nil, 'math.type(function) yields nil')

-- 23.3. Integer arithmetic preserves integer type

do
  local a = 1
  local b = 2
  assertEquals(math.type(a + b), 'integer', 'int + int yields integer')
  assertEquals(math.type(a - b), 'integer', 'int - int yields integer')
  assertEquals(math.type(a * b), 'integer', 'int * int yields integer')
  assertEquals(math.type(a // b), 'integer', 'int // int yields integer')
  assertEquals(math.type(a % b), 'integer', 'int % int yields integer')
end

-- Integer operations producing zero
do
  assertEquals(math.type(1 - 1), 'integer', '1 - 1 yields integer zero')
  assertEquals(math.type(0 * 5), 'integer', '0 * 5 yields integer zero')
  assertEquals(math.type(0 % 1), 'integer', '0 % 1 yields integer zero')
  assertEquals(math.type(0 // 1), 'integer', '0 // 1 yields integer zero')
end

-- 23.4. Float arithmetic preserves float type

do
  local a = 1.0
  local b = 2.0
  assertEquals(math.type(a + b), 'float', 'float + float yields float')
  assertEquals(math.type(a - b), 'float', 'float - float yields float')
  assertEquals(math.type(a * b), 'float', 'float * float yields float')
  assertEquals(math.type(a / b), 'float', 'float / float yields float')
  assertEquals(math.type(a // b), 'float', 'float // float yields float')
  assertEquals(math.type(a % b), 'float', 'float % float yields float')
end

-- Float operations producing zero
do
  assertEquals(math.type(1.0 - 1.0), 'float', '1.0 - 1.0 yields float zero')
  assertEquals(math.type(0.0 * 5.0), 'float', '0.0 * 5.0 yields float zero')
  assertEquals(math.type(0.0 % 1.0), 'float', '0.0 % 1.0 yields float zero')
  assertEquals(math.type(0.0 // 1.0), 'float', '0.0 // 1.0 yields float zero')
end

-- 23.5. Mixed arithmetic promotes to float

do
  assertEquals(math.type(1 + 1.0), 'float', 'int + float yields float')
  assertEquals(math.type(1.0 + 1), 'float', 'float + int yields float')
  assertEquals(math.type(2 * 1.5), 'float', 'int * float yields float')
  assertEquals(math.type(3.0 - 1), 'float', 'float - int yields float')
  assertEquals(math.type(5 // 2.0), 'float', 'int // float yields float')
  assertEquals(math.type(5.0 % 2), 'float', 'float % int yields float')
end

-- Mixed operations producing zero
do
  assertEquals(math.type(1 - 1.0), 'float', '1 - 1.0 yields float zero')
  assertEquals(math.type(0 * 1.0), 'float', '0 * 1.0 yields float zero')
  assertEquals(math.type(0.0 * 1), 'float', '0.0 * 1 yields float zero')
end

-- 23.6. Division and power always produce floats

do
  assertEquals(math.type(4 / 2), 'float', '4 / 2 yields float (2.0)')
  assertEquals(math.type(5 / 2), 'float', '5 / 2 yields float (2.5)')
  assertEquals(math.type(1 / 1), 'float', '1 / 1 yields float (1.0)')

  assertEquals(math.type(2 ^ 3), 'float', '2 ^ 3 yields float (8.0)')
  assertEquals(math.type(2 ^ 0), 'float', '2 ^ 0 yields float (1.0)')
  assertEquals(math.type(10 ^ 2), 'float', '10 ^ 2 yields float (100.0)')
end

-- Division producing zero
do
  assertEquals(math.type(0 / 1), 'float', '0 / 1 yields float zero')
  assertEquals(math.type(0.0 / 1.0), 'float', '0.0 / 1.0 yields float zero')
end

-- 23.7. Unary minus preserves type

do
  assertEquals(math.type(-5), 'integer', '-5 is integer')
  assertEquals(math.type(-0), 'integer', '-0 is integer')

  assertEquals(math.type(-5.0), 'float', '-5.0 is float')
  assertEquals(math.type(-0.0), 'float', '-0.0 is float')
end

-- Unary minus on variables
do
  local i = 5
  local f = 5.0
  assertEquals(math.type(-i), 'integer', 'unary minus int var')
  assertEquals(math.type(-f), 'float', 'unary minus float var')
end

-- Unary minus on expressions
do
  assertEquals(math.type(-(1 + 1)), 'integer', 'unary minus int expr')
  assertEquals(math.type(-(1.0 + 1.0)), 'float', 'unary minus float expr')
end

-- 23.8. String coercion preserves type (tonumber)

do
  assertEquals(math.type(tonumber('5')), 'integer', 'tonumber("5") yields integer')
  assertEquals(math.type(tonumber('5.')), 'float', 'tonumber("5.") yields float')
  assertEquals(math.type(tonumber('.5')), 'float', 'tonumber(".5") yields float')
  assertEquals(math.type(tonumber('5.0')), 'float', 'tonumber("5.0") yields float')
  assertEquals(math.type(tonumber('-0')), 'integer', 'tonumber("-0") yields integer')
  assertEquals(math.type(tonumber('-0.0')), 'float', 'tonumber("-0.0") yields float')
end

-- Hexadecimal literals
do
  assertEquals(math.type(tonumber('0x10')), 'integer', 'tonumber("0x10") yields integer')
  assertEquals(math.type(tonumber('0x10.0')), 'float', 'tonumber("0x10.0") yields float')
  assertEquals(math.type(tonumber('0x1p4')), 'float', 'tonumber("0x1p4") yields float')
end

-- 23.9. Variables preserve type through assignment

do
  local i = 5
  local f = 5.0

  assertEquals(math.type(i), 'integer', 'int variable')
  assertEquals(math.type(f), 'float', 'float variable')

  local i2 = i
  local f2 = f

  assertEquals(math.type(i2), 'integer', 'int variable copy')
  assertEquals(math.type(f2), 'float', 'float variable copy')
end

-- 23.10. Function returns preserve type

do
  local function ret_int()
    return 42
  end

  local function ret_float()
    return 42.0
  end

  assertEquals(math.type(ret_int()), 'integer', 'function returns integer')
  assertEquals(math.type(ret_float()), 'float', 'function returns float')
end

-- 23.11. Table values preserve type

do
  local t = {
    i = 10,
    f = 10.0,
    [1] = 20,
    [2] = 20.0
  }

  assertEquals(math.type(t.i), 'integer', 'table int value (string key)')
  assertEquals(math.type(t.f), 'float', 'table float value (string key)')
  assertEquals(math.type(t[1]), 'integer', 'table int value (int key)')
  assertEquals(math.type(t[2]), 'float', 'table float value (int key)')
end

-- 23.12. For-loop variable type tracking

do
  -- Integer loop
  for i = 1, 3 do
    assertEquals(math.type(i), 'integer', 'for 1,3: var is integer')
    break  -- Just test first iteration
  end

  -- Float loop (start is float)
  for i = 1.0, 3 do
    assertEquals(math.type(i), 'float', 'for 1.0,3: var is float')
    break
  end

  -- Float loop (step is float)
  for i = 1, 3, 1.0 do
    assertEquals(math.type(i), 'float', 'for 1,3,1.0: var is float')
    break
  end
end

-- 23.13. Bitwise operations require integers (input & output)

do
  assertEquals(math.type(5 & 3), 'integer', 'bitwise and yields integer')
  assertEquals(math.type(5 | 2), 'integer', 'bitwise or yields integer')
  assertEquals(math.type(5 ~ 1), 'integer', 'bitwise xor yields integer')
  assertEquals(math.type(1 << 5), 'integer', 'left shift yields integer')
  assertEquals(math.type(32 >> 2), 'integer', 'right shift yields integer')
  assertEquals(math.type(~0), 'integer', 'bitwise not yields integer')
end

-- Bitwise operations convert float operands to integer
do
  assertEquals(math.type(5.0 & 3), 'integer', 'float & int yields integer')
  assertEquals(math.type(5 | 2.0), 'integer', 'int | float yields integer')
  assertEquals(math.type(5.0 ~ 1.0), 'integer', 'float ~ float yields integer')
end

-- 23.14. Edge cases: zero types

do
  -- Positive integer zero
  assertEquals(math.type(0), 'integer', '0 is integer')
  assertEquals(math.type(1 - 1), 'integer', '1 - 1 is integer')
  assertEquals(math.type(0 * 1), 'integer', '0 * 1 is integer')

  -- Positive float zero
  assertEquals(math.type(0.0), 'float', '0.0 is float')
  assertEquals(math.type(1.0 - 1.0), 'float', '1.0 - 1.0 is float')

  -- Negative float zero
  assertEquals(math.type(-0.0), 'float', '-0.0 is float')
  assertEquals(math.type(0.0 * -1.0), 'float', '0.0 * -1.0 is float')

  -- Integer operations never produce -0
  assertEquals(math.type(0 * -1), 'integer', '0 * -1 is integer (not -0)')
end

-- 23.15. Special float values

do
  local inf = 1.0 / 0.0
  local neginf = -1.0 / 0.0
  local nan = 0.0 / 0.0

  assertEquals(type(inf), 'number', 'inf has type number')
  assertEquals(type(neginf), 'number', '-inf has type number')
  assertEquals(type(nan), 'number', 'nan has type number')

  assertEquals(math.type(inf), 'float', 'inf has math.type float')
  assertEquals(math.type(neginf), 'float', '-inf has math.type float')
  assertEquals(math.type(nan), 'float', 'nan has math.type float')
end

-- 23.16. Type consistency across operations

do
  local i = 10
  local sum_i = 0

  for n = 1, 5 do
    sum_i = sum_i + n
    assertEquals(math.type(sum_i), 'integer', 'integer sum stays integer')
  end

  local f = 10.0
  local sum_f = 0.0

  for n = 1.0, 5.0 do
    sum_f = sum_f + n
    assertEquals(math.type(sum_f), 'float', 'float sum stays float')
  end
end
