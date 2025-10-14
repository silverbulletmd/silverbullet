local function assert_eq(actual, expected, message)
  if actual ~= expected then
    error('Assertion failed: ' .. message)
  end
end

local function assert_throws(msg_substr, fn)
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
assert_eq(1/0 == 1/-0, true, 'int: 1/0 == 1/-0 (+Inf)')
assert_eq(-1/0 == 1/-0, false, 'int: -1/0 != 1/-0')

-- 1.2. Float zeros sign preservation
assert_eq(1/0.0 == 1/-0.0, false, 'float: +Inf != -Inf')
assert_eq(1/0.0 == -1/-0.0, true, 'float: 1/0.0 == -1/-0.0')
assert_eq(-1/0.0 == 1/-0.0, true, 'float: -1/0.0 == 1/-0.0')

-- 1.3. Basic division
assert_eq(5/2, 2.5, 'div: 5/2 == 2.5')
assert_eq(-5/2, -2.5, 'div: -5/2 == -2.5')
assert_eq(5/-2, -2.5, 'div: 5/-2 == -2.5')
assert_eq(-5/-2, 2.5, 'div: -5/-2 == 2.5')

-- 2. Unary minus literals and simple expressions
assert_eq(1/-(0) == 1/0, true, 'unary minus: int literal (+Inf)')
assert_eq(1/-(0.0) == -1/0.0, true, 'unary minus: float literal (-Inf)')
assert_eq(1/-(1-1) == 1/0, true, 'unary minus: int expr (+Inf)')
assert_eq(1/-(1.0-1.0) == -1/0.0, true, 'unary minus: float expr (-Inf)')

-- 2.1. Unary minus coercion and precedence with power
assert_eq(-2^2, -4, 'precedence: -2^2 == -(2^2)')
assert_eq((-2)^2, 4, 'precedence: (-2)^2 == 4')

-- 3. Integer operations (must not produce -0)
assert_eq(1/(1-1) == 1/0, true, 'int: sub (+0)')
assert_eq(1/(0*-1) == 1/0, true, 'int: mul (+0)')
assert_eq(1/(0%1) == 1/0, true, 'int: mod (+0)')
assert_eq(1/(0%-1) == 1/0, true, 'int: mod neg divisor (+0)')

-- 4. Float operations (must preserve -0.0)
assert_eq(1/(0.0*-1.0) == -1/ 0.0, true, 'float: mul (-0.0)')
assert_eq(1/((-0.0)%1.0) == -1/ 0.0, true, 'float: mod (-0.0)')
assert_eq(1/((-0.0)%-1.0) == -1/ 0.0, true, 'float: mod neg divisor (-0.0)')

-- 4.1. Zero result from float addition prefers +0.0
assert_eq(1/((-0.0)+0.0) == 1/0.0, true, 'float: (-0.0)+0.0 yields +0.0')

-- 5. Mixed arithmetic producing zero
assert_eq(1/(0*-1.0) == -1/0.0, true, 'mixed: mul int*float (-0.0)')
assert_eq(1/(0.0*-1 ) == -1/0.0, true, 'mixed: mul float*int (-0.0)')
assert_eq(1/(1.0+(-1)) == 1/0.0, true, 'mixed: add (+0.0)')
assert_eq(1/(-(1-1.0)) == -1/0.0, true, 'mixed: sub then unary minus (-0.0)')

-- 6. Variables
local zi, zf, zfn = 0, 0.0, -0.0

assert_eq(1/zi == 1/0, true, 'var: zi (+Inf)')
assert_eq(1/zf == 1/0.0, true, 'var: zf (+Inf)')
assert_eq(1/zfn == -1/0.0, true, 'var: zfn (-Inf)')
assert_eq(1/-(zi) == 1/0, true, 'var: unary minus zi (+Inf)')
assert_eq(1/-(zfn) == 1/0.0, true, 'var: unary minus zfn (+Inf)')

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

assert_eq(1/ret_zi() == 1/0, true, 'fn: ret_zi (+Inf)')
assert_eq(1/ret_zf() == 1/0.0, true, 'fn: ret_zf (+Inf)')
assert_eq(1/ret_zfn() == -1/0.0, true, 'fn: ret_zfn (-Inf)')

assert_eq(1/-(ret_zi()) == 1/0, true, 'fn unary minus: ret_zi (+Inf)')
assert_eq(1/-(ret_zf()) == -1/0.0, true, 'fn unary minus: ret_zf (-Inf)')
assert_eq(1/-(ret_zfn()) == 1/0.0, true, 'fn unary minus: ret_zfn (+Inf)')

-- 8. Tables and arrays
local t, arr = {zi=zi, zfn=zfn}, {zi, zfn}

-- 8.1. Tables
assert_eq(1/t.zi == 1/0, true, 'table: t.zi (+Inf)')
assert_eq(1/t.zfn == -1/0.0, true, 'table: t.zfn (-Inf)')

-- 8.2. Arrays
assert_eq(1/arr[1] == 1/0, true, 'array: arr[1]=zi (+Inf)')
assert_eq(1/arr[2] == -1/0.0, true, 'array: arr[2]=zfn (-Inf)')

-- 9. Deeply nested parentheses and expressions
local xi, xf = 1-1, 1.0-1.0
local deepi = -((((0+0)-(1-1))+(zi-xi))) -- int path (+0)
local deepf = -((((0.0+0.0)-(1.0-1.0))+(zf-xf))) -- float path (-0.0)

assert_eq(1/deepi == 1/0, true, 'nested: int (+Inf)')
assert_eq(1/deepf == -1/0.0, true, 'nested: float (-Inf)')

-- 10. Floor division near zero
assert_eq(1/(0//1) == 1/0, true, 'floor div: int (+0)')
assert_eq(1/(0.0//1.0) == 1/0.0, true, 'floor div: float (+Inf)')
assert_eq(1/((-0.0)//1.0) == -1/0.0, true, 'floor div: float (-Inf)')
assert_eq(1/(0//1.0) == 1/0.0, true, 'floor div: mixed (+0.0)')

-- 10.1. Modulo/division identity
local function id_ok(a, b)
  return a == b * (a // b) + a % b
end

assert_eq(id_ok(5, 2), true, 'identity: 5, 2')
assert_eq(id_ok(-5, 2), true, 'identity: -5, 2')
assert_eq(id_ok(5, -2), true, 'identity: 5, -2')
assert_eq(id_ok(-5, -2), true, 'identity: -5, -2')

-- 10.2. Floor division signs
assert_eq(5//-2, -3, 'idiv: 5//-2 == -3')
assert_eq(-5//2, -3, 'idiv: -5//2 == -3')
assert_eq(-5//-2, 2, 'idiv: -5//-2 == 2')

-- 11. Ordering and NaN
assert_eq((-0.0) < (0.0), false, 'ordering: -0.0 < 0.0 is false')
assert_eq((0.0) < (-0.0), false, 'ordering: 0.0 < -0.0 is false')
assert_eq((-0.0) <= (0.0), true, 'ordering: -0.0 <= 0.0')
assert_eq((0.0) <= (-0.0), true, 'ordering: 0.0 <= -0.0')
assert_eq((0/0) == (0/0), false, 'NaN: never equals itself')

-- 12. Bitwise operators
assert_eq((~0) == -1, true, 'bitwise not on int ok')

val = pcall(
  function()
    return ~0.0
  end
)
assert_eq(val, true, 'bitwise not on float ok')

val = pcall(
  function()
    return 0<<1
  end
)
assert_eq(val, true, 'shl int ok')

val = pcall(
  function()
    return 0.0<<1
  end
)
assert_eq(val, true, 'shl float ok')

-- 12.1 Bitwise ops results
assert_eq((5&3) == 1, true, 'bitwise and result')
assert_eq((5|2) == 7, true, 'bitwise or result')
assert_eq((5~1) == 4, true, 'bitwise xor result')
assert_eq((1<<5) == 32, true, 'bitwise shl result')
assert_eq((32>>5) == 1, true, 'bitwise shr result')

-- 12.2 Bitwise with float values
assert_eq((~(-0.0)) == -1, true, 'bitwise not on -0.0 == -1')

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
assert_eq(table.concat(log, ''), 'LR', 'order: +')

log = {}
val = lhs_num()-rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: -')

log = {}
val = lhs_num()*rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: *')

log = {}
val = lhs_num()/rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: /')

-- floor div and mod
log = {}
val = lhs_num()//rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: //')

log = {}
val = lhs_num()%rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: %')

-- power and concatenation
log = {}
val = lhs_num()^rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: ^')

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
assert_eq(table.concat(log, ''), 'LR', 'order: ..')

-- relational
log = {}
val = (lhs_num() < rhs_num())
assert_eq(table.concat(log, ''), 'LR', 'order: <')

log = {}
val = (lhs_num() <= rhs_num())
assert_eq(table.concat(log, ''), 'LR', 'order: <=')

log = {}
val = (lhs_num() > rhs_num())
assert_eq(table.concat(log, ''), 'LR', 'order: >')

log = {}
val = (lhs_num() >= rhs_num())
assert_eq(table.concat(log, ''), 'LR', 'order: >=')

log = {}
val = (lhs_num() == rhs_num())
assert_eq(table.concat(log, ''), 'LR', 'order: ==')

log = {}
val = (lhs_num() ~= rhs_num())
assert_eq(table.concat(log, ''), 'LR', 'order: ~=')

-- bitwise
log = {}
val = lhs_num()&rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: &')

log = {}
val = lhs_num()|rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: |')

log = {}
val = lhs_num()~rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: ~ (xor)')

log = {}
val = lhs_num()<<rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: <<')

log = {}
val = lhs_num()>>rhs_num()
assert_eq(table.concat(log, ''), 'LR', 'order: >>')

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
assert_eq(val, 512, 'nested expression result')
assert_eq(table.concat(log, ''), 'ABC', 'nested expression associativity')

assert_eq(2^3^2, 512, 'power associativity')

-- 14. String-to-number coercion around zero
assert_eq(1/('0') == 1/0.0, true, 'str: ("0") (+Inf)')
assert_eq(1/('-0') == 1/0.0, true, 'str: ("-0") (+Inf)')
assert_eq(1/('0.0') == 1/0.0, true, 'str: ("0.0") (+Inf)')
assert_eq(1/('-0.0') == -1/0.0, true, 'str: ("-0.0") (-Inf)')
assert_eq(1/-('0') == 1/0.0, true, 'str: unary minus -("0") (+Inf)')
assert_eq(1/-('-0') == 1/0.0, true, 'str: unary minus -("-0") (+Inf)')

-- 14.1. General arithmetic with numeric strings
assert_eq('1'+2, 3, 'str-num: "1"+2 == 3')
assert_eq(' -2 ' * '3', -6, 'str-num: " -2 " * "3" == -6')
assert_eq('0x10' + 1, 17, 'str-num: hex int string + 1 == 17')
assert_eq('0x1p4' + 0, 16, 'str-num: hex float string + 0 == 16')
assert_throws('attempt to perform arithmetic on a non-number',
  function()
    return 'x1'+1
  end
)

-- 15. Recursive function producing int zero (and unary minus)
local function rec_zero(n)
  if n == 0 then
    return 0
  end
  return -rec_zero(n - 1)
end

assert_eq(1/rec_zero(5) == 1/0, true, 'recursive: rec_zero (+Inf)')
assert_eq(1/(rec_zero(5)) == 1/0, true, 'recursive: (rec_zero) (+Inf)')
assert_eq(1/-(rec_zero(5)) == 1/0, true, 'recursive: -(rec_zero) (+Inf)')
assert_eq(1/-rec_zero(5) == 1/0, true, 'recursive: -(rec_zero) (+Inf)')

-- 16. Modulo and integer division by zero

-- 16.1. Modulo by zero
assert_throws('modulo by zero',
  function()
    return 1%0
  end
)

val = pcall(
  function()
    return 1.0%0.0
  end
)
assert_eq(val, true, 'float mod by zero ok (NaN)')

val = pcall(
  function()
    return 1.0%0
  end
)
assert_eq(val, true, 'mixed (float,int) mod by zero ok (NaN)')

val = pcall(
  function()
    return 1%0.0
  end
)
assert_eq(val, true, 'mixed (int,float) mod by zero ok (NaN)')

-- 16.2. Integer division by zero
assert_throws('divide by zero',
  function()
    return 1//0
  end
)

val = pcall(
  function()
    return 1.0//0.0
  end
)
assert_eq(val, true, 'float idiv by zero ok (+Inf/-Inf)')

val = pcall(
  function()
    return 1.0//0
  end
)
assert_eq(val, true, 'mixed (float,int) idiv by zero ok (+Inf/-Inf)')

val = pcall(
  function()
    return 1//0.0
  end
)
assert_eq(val, true, 'mixed (int,float) idiv by zero ok (+Inf/-Inf)')

-- 16.3. Modulo sign semantics (explicit)
assert_eq(5 % -2, -1, 'mod: 5 % -2 == -1')
assert_eq(-5 % 2, 1, 'mod: -5 % 2 == 1')
assert_eq(-5 % -2, -1, 'mod: -5 % -2 == -1')

-- 17. Metamethod precedence: __add should dispatch
local mt = {
  __add = function(_, _)
    return 'added'
  end
}
local tbl = setmetatable({}, mt)

assert_eq(tbl + tbl, 'added', '__add dispatched')

-- 17.1 Unary metamethod: __unm (negation)
local mt_unm = {
  __unm = function(_)
    return 'negated'
  end
}
local u = setmetatable({}, mt_unm)

assert_eq(-u, 'negated', '__unm dispatched')

-- 17.2 Unary metamethod: __bnot (bitwise NOT)
local bnot_calls = 0
local mt_bnot = {
  __bnot = function(_)
    bnot_calls = bnot_calls + 1
    return 123
  end
}
local b = setmetatable({}, mt_bnot)

assert_eq(~b, 123, '__bnot dispatched')
assert_eq(bnot_calls, 1, '__bnot called exactly once')

-- 17.3. Unary metamethods multi-return (first return only)
local mt_unm_mr = {
  __unm = function(_)
    return 7, 8
  end
}
local um = setmetatable({}, mt_unm_mr)

assert_eq(-um, 7, '__unm uses first return value')

local mt_bnot_mr = {
  __bnot = function(_)
    return 9, 10
  end
}
local bm = setmetatable({}, mt_bnot_mr)

assert_eq(~bm, 9, '__bnot uses first return value')

-- 18. Multi-return in arithmetic (first return only)
local function multi_ret()
  return 0, 1
end

assert_eq(1/(multi_ret()) == 1/0, true, 'multi-ret: 1st used (+Inf)')
assert_eq(1/-(multi_ret()) == 1/0, true, 'multi-ret: unary minus 1st used (+Inf)')

-- 18.1 Exponentiation zero edge cases
assert_eq(0^0 == 1, true, 'pow: 0^0 == 1')
assert_eq((-0.0)^0 == 1, true, 'pow: (-0.0)^0 == 1')

-- 19. Error tests
assert_throws('has no integer representation',
  function()
    return ~0.5
  end
)

assert_throws('attempt to perform arithmetic on a non-number',
  function()
    return 'a'+1
  end
)

assert_throws('attempt to perform arithmetic on a non-number',
  function()
    return -{}
  end
)

-- 19.1. Bitwise on non-integers should error
assert_throws('has no integer representation',
  function()
    return 1.5&1
  end
)

assert_throws('attempt to perform arithmetic on a non-number',
  function()
    return '3'|1
  end
)

assert_throws('has no integer representation',
  function()
    return 1~1.2
  end
)

assert_throws('has no integer representation',
  function()
    return 1<<0.1
  end
)

-- 19.2. Relational type error
assert_throws('attempt to compare number with string',
  function()
    return 1<'1'
  end
)

-- 19.3. Additional negative tests
assert_throws('attempt to perform arithmetic on a non-number',
  function()
    return 1+{}
  end
)

assert_throws('attempt to perform arithmetic on a non-number',
  function()
    return -'x'
  end
)

assert_throws('attempt to perform arithmetic on a non-number',
  function()
    return ~'1'
  end
)

assert_throws('attempt to compare string with number',
  function()
    return '1'<1
  end
)

assert_throws('attempt to compare number with object',
  function()
    return 1<{}
  end
)
