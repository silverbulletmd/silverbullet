local function assert_eq(act, exp, msg)
  if act ~= exp then
    local act, exp = tostring(act), tostring(exp)
    error('assert_eq failed: ' .. msg .. ' (actual=' .. act .. ', expected=' .. exp .. ')')
  end
end

-- 1. Base: integer vs float zero divisors

-- 1.1. Integer zeros collapse: no -0 for integers

assert_eq( 1/0 == 1/-0, true,  'int:  1/0 == 1/-0 (+Inf)')
assert_eq(-1/0 == 1/-0, false, 'int: -1/0 != 1/-0')

-- 1.2. Float zeros preserve sign

assert_eq( 1/0.0 ==  1/-0.0, false, 'float: +Inf   != -Inf')
assert_eq( 1/0.0 == -1/-0.0, true,  'float:  1/0.0 == -1/-0.0')
assert_eq(-1/0.0 ==  1/-0.0, true,  'float: -1/0.0 ==  1/-0.0')

-- 2. Unary minus: literals and simple expressions

assert_eq(1/-(0)       ==  1/0,   true, 'unary - int literal -> +Inf')
assert_eq(1/-(0.0)     == -1/0.0, true, 'unary - float literal -> -Inf')
assert_eq(1/-(1-1)     ==  1/0,   true, 'unary - int expr -> +Inf')
assert_eq(1/-(1.0-1.0) == -1/0.0, true, 'unary - float expr -> -Inf')

-- 3. Integer ops: must never produce -0

assert_eq(1/(1-1)  == 1/0, true, 'int sub -> +0')
assert_eq(1/(0*-1) == 1/0, true, 'int mul -> +0')
assert_eq(1/(0%1)  == 1/0, true, 'int mod -> +0')
assert_eq(1/(0%-1) == 1/0, true, 'int mod (neg divisor) -> +0')

-- 4. Float ops: preserve -0.0 where applicable

assert_eq(1/(0.0*-1.0)    == -1/ 0.0, true, 'float mul -> -0.0')
assert_eq(1/((-0.0)%1.0)  == -1/ 0.0, true, 'float mod -> -0.0')
assert_eq(1/((-0.0)%-1.0) == -1/ 0.0, true, 'float mod (neg divisor) -> -0.0')

-- 5. Mixed arithmetic producing zero

assert_eq(1/(0   * -1.0) == -1/0.0, true, 'mixed mul int*float -> -0.0')
assert_eq(1/(0.0 * -1  ) == -1/0.0, true, 'mixed mul float*int -> -0.0')
assert_eq(1/(1.0 + (-1)) ==  1/0.0, true, 'mixed add -> +0.0')
assert_eq(1/(-(1 - 1.0)) == -1/0.0, true, 'mixed sub then unary "-" -> -0.0')

-- 6. Variables

local zi, zf, zfn = 0, 0.0, -0.0

assert_eq(1/zi     ==  1/ 0,    true, 'var: zi  -> +Inf')
assert_eq(1/zf     ==  1/ 0.0,  true, 'var: zf  -> +Inf')
assert_eq(1/zfn    == -1/ 0.0,  true, 'var: zfn -> -Inf')

assert_eq(1/-(zi)  ==  1/ 0,    true, 'var unary "-": zi  -> +Inf')
assert_eq(1/-(zfn) ==  1/ 0.0,  true, 'var unary "-": zfn -> +Inf')

-- 7. Functions returning zeros (and unary "-")

local function ret_zi()
  return 0
end

local function ret_zf()
  return 0.0
end

local function ret_zfn()
  return -0.0
end

assert_eq(1/ret_zi()     ==  1/0,   true, 'fn: ret_zi  -> +Inf')
assert_eq(1/ret_zf()     ==  1/0.0, true, 'fn: ret_zf  -> +Inf')
assert_eq(1/ret_zfn()    == -1/0.0, true, 'fn: ret_zfn -> -Inf')

assert_eq(1/-(ret_zi())  ==  1/0,   true, 'fn unary "-": ret_zi  -> +Inf')
assert_eq(1/-(ret_zf())  == -1/0.0, true, 'fn unary "-": ret_zf  -> -Inf')
assert_eq(1/-(ret_zfn()) ==  1/0.0, true, 'fn unary "-": ret_zfn -> +Inf')

-- 8. Tables and arrays

local t = {
  zi  = zi,
  zfn = zfn
}

local arr = {
  zi,
  zfn
}

-- 8.1. Tables

assert_eq(1/t.zi  ==  1/0,   true, 'table prop: zi  -> +Inf')
assert_eq(1/t.zfn == -1/0.0, true, 'table prop: zfn -> -Inf')

-- 8.2. Arrays

assert_eq(1/arr[1] ==  1/0,   true, 'array[1]=zi  -> +Inf')
assert_eq(1/arr[2] == -1/0.0, true, 'array[2]=zfn -> -Inf')

-- 9. Nested parentheses and deeply nested expressions

local xi, xf = 1-1, 1.0-1.0
local deepi = -((((0 + 0) - (1 - 1)) + (zi - xi)))         -- int path   -> +0
local deepf = -((((0.0 + 0.0) - (1.0 - 1.0)) + (zf - xf))) -- float path -> -0.0

assert_eq(1/deepi ==  1/ 0,   true, 'deep int   -> +Inf')
assert_eq(1/deepf == -1/ 0.0, true, 'deep float -> -Inf')

-- 10. Floor division ("//") near zero

assert_eq(1/(0     //1)   ==  1/ 0,   true, 'int   // -> +0')
assert_eq(1/(0.0   //1.0) ==  1/ 0.0, true, 'float // (+0.0) -> +Inf')
assert_eq(1/((-0.0)//1.0) == -1/ 0.0, true, 'float // (-0.0) -> -Inf')
assert_eq(1/(0     //1.0) ==  1/ 0.0, true, 'mixed // (int,float) -> +0.0')

-- 11. Ordering and NaN checks

assert_eq( (-0.0) <  ( 0.0), false, 'ordering: -0.0 <  0.0 is false')
assert_eq( ( 0.0) <  (-0.0), false, 'ordering:  0.0 < -0.0 is false')
assert_eq( (-0.0) <= ( 0.0), true,  'ordering: -0.0 <= 0.0')
assert_eq( ( 0.0) <= (-0.0), true,  'ordering:  0.0 <= -0.0')
assert_eq( ( 0/0) == ( 0/0), false, 'NaN: never equals itself')

-- 12. Bitwise operators

assert_eq((~0) == -1, true, 'bitwise not on int ok')

local ok = pcall(function() return ~0.0 end)
assert_eq(ok, true, 'bitwise not on float ok')

ok = pcall(function() return 0 << 1 end)
assert_eq(ok, true, 'shl int ok')

ok = pcall(function() return 0.0 << 1 end)
assert_eq(ok, true, 'shl float ok')

-- 13. Evaluation order (left-to-right) for binary ops

local log = {}
local function L() log[#log+1]='L'; return  0   end
local function R() log[#log+1]='R'; return -1.0 end
local _ = L() + R()

assert_eq(table.concat(log, ''), 'LR', 'eval order: left then right')

-- 14. String-to-number coercion around zero

assert_eq(1/("0")    ==  1/0.0, true, 'str: "0"    -> +Inf')
assert_eq(1/("-0")   ==  1/0.0, true, 'str: "-0"   -> +Inf (integer-like zero collapses)')
assert_eq(1/("0.0")  ==  1/0.0, true, 'str: "0.0"  -> +Inf')
assert_eq(1/("-0.0") == -1/0.0, true, 'str: "-0.0" -> -Inf')
assert_eq( 1/-( "0") ==  1/0.0, true, 'str unary "-":  "0" -> +Inf')
assert_eq( 1/-("-0") ==  1/0.0, true, 'str unary "-": "-0" -> +Inf')

-- 15. Recursive function producing int zero (and unary "-" of the result)

local function rec_zero(n)
  if n == 0 then return 0 end
  return -rec_zero(n - 1)
end

assert_eq(1/ (rec_zero(5)) == 1/0, true, 'recursive:  rec_zero -> +Inf')
assert_eq(1/-(rec_zero(5)) == 1/0, true, 'recursive: -rec_zero -> +Inf')

-- 16. Modulo ("%") and integer division ("//") by zero

-- 16.1. Modulo by zero

ok = pcall(function() return 1 % 0 end)
assert_eq(ok, false, 'int mod by zero errors')

ok = pcall(function() return 1.0 % 0.0 end)
assert_eq(ok, true,  'float mod by zero ok (NaN)')

ok = pcall(function() return 1.0 % 0 end)
assert_eq(ok, true,  'mixed (float,int) mod by zero ok (NaN)')

ok = pcall(function() return 1 % 0.0 end)
assert_eq(ok, true,  'mixed (int,float) mod by zero ok (NaN)')

-- 16.2. Integer division by zero

ok = pcall(function() return 1 // 0 end)
assert_eq(ok, false, 'int idiv by zero errors')

ok = pcall(function() return 1.0 // 0.0 end)
assert_eq(ok, true,  'float idiv by zero ok (±Inf)')

ok = pcall(function() return 1.0 // 0 end)
assert_eq(ok, true,  'mixed (float,int) idiv by zero ok (±Inf)')

ok = pcall(function() return 1 // 0.0 end)
assert_eq(ok, true,  'mixed (int,float) idiv by zero ok (±Inf)')

-- 17. Metamethod precedence: __add should dispatch

local mt = {
  __add = function(_,_)
    return 'added'
  end
}

local a = setmetatable({}, mt)

assert_eq(a+a, 'added', '__add dispatched')

-- 18. Multi-return in arithmetic (first result only)

local function mr()
  return 0, 1
end

assert_eq( 1/ (mr()) == 1/ 0, true, 'mr first result used (+Inf)')
assert_eq( 1/-(mr()) == 1/ 0, true, 'unary - uses first result (+Inf)')
