local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error('assert_eq failed: ' .. msg)
  end
end

-- Integer-only (0 and -0 as integers)
-- Expectation: -0 is integer 0, so 1/-0 == +Inf, -1/-0 == +Inf
assert_eq(  1/ 0 ==  1/ 0,  true,  'int:  1/ 0 ==  1/ 0')
assert_eq(  1/ 0 == -1/ 0,  false, 'int:  1/ 0 == -1/ 0')
assert_eq(  1/ 0 ==  1/-0,  true,  'int:  1/ 0 ==  1/-0')
assert_eq(  1/ 0 == -1/-0,  false, 'int:  1/ 0 == -1/-0')

assert_eq( -1/ 0 ==  1/ 0,  false, 'int: -1/ 0 ==  1/ 0')
assert_eq( -1/ 0 == -1/ 0,  true,  'int: -1/ 0 == -1/ 0')
assert_eq( -1/ 0 ==  1/-0,  false, 'int: -1/ 0 ==  1/-0')
assert_eq( -1/ 0 == -1/-0,  true,  'int: -1/ 0 == -1/-0')

assert_eq(  1/-0 ==  1/ 0,  true,  'int:  1/-0 ==  1/ 0')
assert_eq(  1/-0 == -1/ 0,  false, 'int:  1/-0 == -1/ 0')
assert_eq(  1/-0 ==  1/-0,  true,  'int:  1/-0 ==  1/-0')
assert_eq(  1/-0 == -1/-0,  false, 'int:  1/-0 == -1/-0')

assert_eq( -1/-0 ==  1/ 0,  false, 'int: -1/-0 ==  1/ 0')
assert_eq( -1/-0 == -1/ 0,  true,  'int: -1/-0 == -1/0 ')
assert_eq( -1/-0 ==  1/-0,  false, 'int: -1/-0 ==  1/-0')
assert_eq( -1/-0 == -1/-0,  true,  'int: -1/-0 == -1/-0')

-- Float-only (0.0 and -0.0 as floats)
-- Expectation: -0.0 is float negative zero, so 1/-0.0 == -Inf, -1/-0.0 == +Inf
assert_eq(  1/ 0.0 ==  1/ 0.0,  true,  'float:  1/ 0.0 ==  1/ 0.0')
assert_eq(  1/ 0.0 == -1/ 0.0,  false, 'float:  1/ 0.0 == -1/ 0.0')
assert_eq(  1/ 0.0 ==  1/-0.0,  false, 'float:  1/ 0.0 ==  1/-0.0')
assert_eq(  1/ 0.0 == -1/-0.0,  true,  'float:  1/ 0.0 == -1/-0.0')

assert_eq( -1/ 0.0 ==  1/ 0.0,  false, 'float: -1/ 0.0 ==  1/ 0.0')
assert_eq( -1/ 0.0 == -1/ 0.0,  true,  'float: -1/ 0.0 == -1/ 0.0')
assert_eq( -1/ 0.0 ==  1/-0.0,  true,  'float: -1/ 0.0 ==  1/-0.0')
assert_eq( -1/ 0.0 == -1/-0.0,  false, 'float: -1/ 0.0 == -1/-0.0')

assert_eq(  1/-0.0 ==  1/ 0.0,  false, 'float:  1/-0.0 ==  1/ 0.0')
assert_eq(  1/-0.0 == -1/ 0.0,  true,  'float:  1/-0.0 == -1/ 0.0')
assert_eq(  1/-0.0 ==  1/-0.0,  true,  'float:  1/-0.0 ==  1/-0.0')
assert_eq(  1/-0.0 == -1/-0.0,  false, 'float:  1/-0.0 == -1/-0.0')

assert_eq( -1/-0.0 ==  1/ 0.0,  true,  'float: -1/-0.0 ==  1/ 0.0')
assert_eq( -1/-0.0 == -1/ 0.0,  false, 'float: -1/-0.0 == -1/ 0.0')
assert_eq( -1/-0.0 ==  1/-0.0,  false, 'float: -1/-0.0 ==  1/-0.0')
assert_eq( -1/-0.0 == -1/-0.0,  true,  'float: -1/-0.0 == -1/-0.0')

-- Integer-Float (left int 0/-0; right float 0.0/-0.0)
assert_eq(  1/ 0 ==  1/ 0.0,  true,  'int-float:  1/0 ==  1/ 0.0')
assert_eq(  1/ 0 == -1/ 0.0,  false, 'int-float:  1/0 == -1/ 0.0')
assert_eq(  1/ 0 ==  1/-0.0,  false, 'int-float:  1/0 ==  1/-0.0')
assert_eq(  1/ 0 == -1/-0.0,  true,  'int-float:  1/0 == -1/-0.0')

assert_eq( -1/ 0 ==  1/ 0.0,  false, 'int-float: -1/0 ==  1/ 0.0')
assert_eq( -1/ 0 == -1/ 0.0,  true,  'int-float: -1/0 == -1/ 0.0')
assert_eq( -1/ 0 ==  1/-0.0,  true,  'int-float: -1/0 ==  1/-0.0')
assert_eq( -1/ 0 == -1/-0.0,  false, 'int-float: -1/0 == -1/-0.0')

assert_eq(  1/-0 ==  1/ 0.0,  true,  'int-float:  1/-0 ==  1/ 0.0')
assert_eq(  1/-0 == -1/ 0.0,  false, 'int-float:  1/-0 == -1/ 0.0')
assert_eq(  1/-0 ==  1/-0.0,  false, 'int-float:  1/-0 ==  1/-0.0')
assert_eq(  1/-0 == -1/-0.0,  true,  'int-float:  1/-0 == -1/-0.0')

assert_eq( -1/-0 ==  1/ 0.0,  false, 'int-float: -1/-0 ==  1/ 0.0')
assert_eq( -1/-0 == -1/ 0.0,  true,  'int-float: -1/-0 == -1/ 0.0')
assert_eq( -1/-0 ==  1/-0.0,  true,  'int-float: -1/-0 ==  1/-0.0')
assert_eq( -1/-0 == -1/-0.0,  false, 'int-float: -1/-0 == -1/-0.0')

-- Float-Integer (left float 0.0/-0.0; right int 0/-0)
assert_eq(  1/ 0.0 ==  1/ 0,  true,  'float-int:  1/0.0 ==  1/ 0')
assert_eq(  1/ 0.0 == -1/ 0,  false, 'float-int:  1/0.0 == -1/ 0')
assert_eq(  1/ 0.0 ==  1/-0,  true,  'float-int:  1/0.0 ==  1/-0')
assert_eq(  1/ 0.0 == -1/-0,  false, 'float-int:  1/0.0 == -1/-0')

assert_eq( -1/ 0.0 ==  1/ 0,  false, 'float-int: -1/0.0 ==  1/ 0')
assert_eq( -1/ 0.0 == -1/ 0,  true,  'float-int: -1/0.0 == -1/ 0')
assert_eq( -1/ 0.0 ==  1/-0,  false, 'float-int: -1/0.0 ==  1/-0')
assert_eq( -1/ 0.0 == -1/-0,  true,  'float-int: -1/0.0 == -1/-0')

assert_eq(  1/-0.0 ==  1/ 0,  false, 'float-int:  1/-0.0 ==  1/ 0')
assert_eq(  1/-0.0 == -1/ 0,  true,  'float-int:  1/-0.0 == -1/ 0')
assert_eq(  1/-0.0 ==  1/-0,  false, 'float-int:  1/-0.0 ==  1/-0')
assert_eq(  1/-0.0 == -1/-0,  true,  'float-int:  1/-0.0 == -1/-0')

assert_eq( -1/-0.0 ==  1/ 0,  true,  'float-int: -1/-0.0 ==  1/ 0')
assert_eq( -1/-0.0 == -1/ 0,  false, 'float-int: -1/-0.0 == -1/ 0')
assert_eq( -1/-0.0 ==  1/-0,  true,  'float-int: -1/-0.0 ==  1/-0')
assert_eq( -1/-0.0 == -1/-0,  false, 'float-int: -1/-0.0 == -1/-0')
