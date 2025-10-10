local function assert_eq(actual, expected, message)
  if actual ~= expected then
    error('Assertion failed: ' .. message)
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

-- 2. Unary minus literals and simple expressions
assert_eq(1/-(0) == 1/0, true, 'unary minus: int literal (+Inf)')
assert_eq(1/-(0.0) == -1/0.0, true, 'unary minus: float literal (-Inf)')
assert_eq(1/-(1-1) == 1/0, true, 'unary minus: int expr (+Inf)')
assert_eq(1/-(1.0-1.0) == -1/0.0, true, 'unary minus: float expr (-Inf)')

-- 3. Integer operations (must not produce -0)
assert_eq(1/(1-1) == 1/0, true, 'int: sub (+0)')
assert_eq(1/(0*-1) == 1/0, true, 'int: mul (+0)')
assert_eq(1/(0%1) == 1/0, true, 'int: mod (+0)')
assert_eq(1/(0%-1) == 1/0, true, 'int: mod neg divisor (+0)')

-- 4. Float operations (must preserve -0.0)
assert_eq(1/(0.0*-1.0) == -1/ 0.0, true, 'float: mul (-0.0)')
assert_eq(1/((-0.0)%1.0) == -1/ 0.0, true, 'float: mod (-0.0)')
assert_eq(1/((-0.0)%-1.0) == -1/ 0.0, true, 'float: mod neg divisor (-0.0)')

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
val = pcall(
  function()
    return 1%0
  end
)
assert_eq(val, false, 'int mod by zero errors')

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
val = pcall(
  function()
    return 1//0
  end
)
assert_eq(val, false, 'int idiv by zero errors')

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

-- 17. Metamethod precedence: __add should dispatch
local mt = {
  __add = function(_, _)
    return 'dispatched'
  end
}
local tbl = setmetatable({}, mt)

assert_eq(tbl + tbl, 'dispatched', '__add dispatched')

-- 18. Multi-return in arithmetic (first result only)
local function multi_ret()
  return 0, 1
end

assert_eq(1/(multi_ret()) == 1/0, true, 'multi-ret: 1st used (+Inf)')
assert_eq(1/-(multi_ret()) == 1/0, true, 'multi-ret: unary minus 1st used (+Inf)')

-- 18.1 Exponentiation zero edge cases
assert_eq(0^0 == 1, true, 'pow: 0^0 == 1')
assert_eq((-0.0)^0 == 1, true, 'pow: (-0.0)^0 == 1')

-- 19. Error tests
val = pcall(
  function()
    return ~0.5
  end
)
assert_eq(val, false, 'error: unary bitwise not on float')

val = pcall(
  function()
    return 'a'+1
  end
)
assert_eq(val, false, 'error: string plus number')

val = pcall(
  function()
    return -{}
  end
)
assert_eq(val, false, 'error: unary minus on table')

-- 19.1 Bitwise on non-integers should error
val = pcall(
  function()
    return 1.5&1
  end
)
assert_eq(val, false, 'error: bitwise and on float')

val = pcall(
  function()
    return '3'|1
  end
)
assert_eq(val, false, 'error: bitwise or with string')

val = pcall(
  function()
    return 1~1.2
  end
)
assert_eq(val, false, 'error: bitwise xor with float')

val = pcall(
  function()
    return 1<<0.1
  end
)
assert_eq(val, false, 'error: bitwise shift with float')

-- 19.2 Relational type error
val = pcall(
  function()
    return 1<'1'
  end
)
assert_eq(val, false, 'error: rel cmp num and str')
