local function assertEqual(a, b, message)
  if a ~= b then
    error("Assertion failed: " .. tostring(a)
      .. " != " .. tostring(b) .. " " .. (message or ""))
  end
end

local function contains(hay, needle)
  return string.find(tostring(hay), needle, 1, true) ~= nil
end

local function expect_error(fn, needle, msg)
  local ok, err = pcall(fn)
  if ok then
    error("Expected error, but call succeeded: " .. (msg or ""))
  end
  local s = tostring(err)
  if not contains(s, needle) then
    error("Error missing expected text '" .. needle .. "': got " .. s)
  end
end

-- Basic forward jump
do
  local x = 0
  goto after_init
  x = -1 -- skipped
  ::after_init:: x = x + 2
  assertEqual(x, 2)
end

-- Backward jump (simulated loop)
do
  local n = 0
  ::loop_start::
  n = n + 1
  if n < 3 then goto loop_start end
  assertEqual(n, 3)
end

-- Consecutive labels (two labels before one statement)
do
  local v = 0
  ::first_label::::second_label:: v = v + 1
  assertEqual(v, 1)
end

-- No visible label (forward into inner block / outward from inner)
do
  local function f() goto missing; do ::missing:: end end
  expect_error(f, "no visible label 'missing'")
  local function g() do ::inner:: end; goto inner end
  expect_error(g, "no visible label 'inner'")
end

-- Duplicate label in same block
do
  local function f() ::dup:: ::dup:: end
  expect_error(f, "label 'dup'")
  local function g() ::dup:: do ::dup:: end end
  expect_error(g, "label 'dup'")
end

-- Jump into local scope (illegal forward into variable region)
do
  local function f()
    goto after_local
    local a = 1
    ::after_local:: return a
  end
  expect_error(f, "jumps into the scope")
end

-- Repeat loop: safe-end label NOT allowed to bypass scope
do
  local function f()
    local flag = false
    repeat
      if flag then goto after_repeat end
      local hidden = 10
      ::after_repeat:: -- repeat end label scope test
    until hidden and flag
  end
  expect_error(f, "jumps into the scope")
end

-- Safe end-of-block backward jump (allowed)
do
  local function f()
    do local a = 1 end
    ::end_block:: return 42
  end
  assertEqual(f(), 42)
end

-- Multi-label end sentinel (extra labels + semicolons)
do
  local x
  do
    local y = 12
    goto set_x
    ::after_set:: x = x + 1; goto check_x
    ::set_x:: x = y; goto after_set
  end
  ::check_x:: ::check_x_extra:: assertEqual(x, 13)
end

-- Skip local declarations (labels before local)
do
  goto after_vars
  local a = 23
  a = a
  ::after_vars:: ;
end

-- While loop labels inside loop; external exit
do
  local global = 13
  while true do
    goto exit_loop
    goto loop_label
    goto loop_label
    local inner = 45
    ::loop_label:: ;;;
  end
  ::exit_loop:: assertEqual(global, 13)
end

-- Mixed returns via labels (branch selection)
local function branch_test(a)
  if a == 1 then
    goto l1
  elseif a == 2 then
    goto l2
  elseif a == 3 then
    goto l3
  elseif a == 4 then
    goto l1
    ::l1:: a = a + 1
  else
    goto l4
    ::l4_a:: a = a * 2; goto l4_b
    ::l4:: goto l4_a
    ::l4_b::
  end
  do return a end
  ::l2:: do return "2" end
  ::l3:: do return "3" end
  ::l1:: return "1"
end

assertEqual(branch_test(1), "1")
assertEqual(branch_test(2), "2")
assertEqual(branch_test(3), "3")
assertEqual(branch_test(4), 5)
assertEqual(branch_test(5), 10)

-- Same label name in different functions (allowed)
do
  local function f() ::same:: return 1 end
  local function g() ::same:: return 2 end
  assertEqual(f(), 1)
  assertEqual(g(), 2)
end

-- Upward jump into ancestor block
do
  local n = 0
  ::up_loop::
  n = n + 1
  if n < 2 then
    do
      goto up_loop
    end
  end
  assertEqual(n, 2)
end

-- Escape potential infinite loop via early goto
do
  goto escaped
  ::inf_a:: goto inf_a
  ::inf_b:: goto inf_c
  ::inf_c:: goto inf_b
  ::escaped:: ;
end

-- Sequential building of array with gotos
local function build_array()
  local a = {}
  goto start
  ::add_one:: a[#a + 1] = 1; goto add_two
  ::add_two:: a[#a + 1] = 2; goto add_five
  ::start:: ::start_extra:: a[#a + 1] = 3; goto add_one
  ::add_four:: a[#a + 1] = 4; goto finish
  ::add_five:: a[#a + 1] = 5; goto add_four
  ::finish:: return a
end

do
  local arr = build_array()
  assertEqual(arr[1], 3)
  assertEqual(arr[2], 1)
  assertEqual(arr[3], 2)
  assertEqual(arr[4], 5)
  assertEqual(arr[5], 4)
end

-- Long label name (basic acceptance)
do
  ::very_long_label_end_marker_example_for_stress_test_end::
  local ok = true
  assertEqual(ok, true)
end

-- Sibling block visibility (cannot jump to sibling label)
do
  local function f()
    do ::sib:: end
    do goto sib end
  end
  expect_error(f, "no visible label 'sib'", "cannot jump to sibling label")
end

-- Forward to inside for: label not visible from outside
do
  local function f()
    goto in_for
    for i = 1, 2 do
      ::in_for:: return i
    end
  end
  expect_error(f, "no visible label 'in_for'")
end

-- Forward to inside for-in: label not visible from outside
do
  local function f()
    goto in_forin
    for k, v in pairs({1,2}) do
      ::in_forin:: return k
    end
  end
  expect_error(f, "no visible label 'in_forin'")
end

-- Repeat block end scope jump (illegal)
do
  local function f()
    repeat
      goto end_repeat
      local z = 10
      ::end_repeat::
    until z == 0
  end
  expect_error(f, "jumps into the scope")
end

-- Nested upward multi-jump
do
  local count = 0
  ::multi_up::
  count = count + 1
  if count < 3 then
    do
      do
        goto multi_up
      end
    end
  end
  assertEqual(count, 3)
end

-- Late label after inner block; allowed upward visibility
do
  local function f()
    do
      goto late_label
    end
    ::late_label:: return 1
  end
  assertEqual(f(), 1)
end

-- Upward goto to ancestor label inside nested block
do
  local function f()
    local n = 0
    ::ancestor:: n = n + 1
    do
      if n < 2 then goto ancestor end
    end
    return n
  end
  assertEqual(f(), 2)
end

-- Same label name reused in separate blocks (legal)
do
  local function f()
    local t = {}
    do ::lbl:: table.insert(t, "first") end
    do ::lbl:: table.insert(t, "second") end
    return t
  end
  local r = f()
  assertEqual(r[1], "first")
  assertEqual(r[2], "second")
end

-- Label visibility restricted to branch (goto in else to label in then)
do
  local function f_bad(flag)
    if flag then
      ::branch_label:: return "yes"
    else
      goto branch_label
    end
  end
  expect_error(function() f_bad(true) end, "no visible label 'branch_label'")
  expect_error(function() f_bad(false) end, "no visible label 'branch_label'")
end

-- Label visible to both branches (label placed after the if)
do
  local function f_good(flag)
    if not flag then goto after end
    ::after:: return "yes"
  end
  assertEqual(f_good(true), "yes")
  assertEqual(f_good(false), "yes")
end

-- Jump over multiple locals but not into them (allowed backward)
do
  local function f()
    local a = 1
    ::compute::
    local b = a + 1
    local c = b + 1
    if c < 5 then
      a = c
      goto compute -- backward: allowed
    end
    return c
  end
  assertEqual(f(), 5)
end

-- Label at end of block with only semicolons after (safe end)
do
  local function f()
    local x = 10
    ::end_ok:: ; ; ;
    return x
  end
  assertEqual(f(), 10)
end

-- Goto into local scope through chained labels (error)
do
  local function f()
    goto after_chain
    local p = 99
    ::chain_a::::chain_b::::after_chain:: return p
  end
  expect_error(f, "jumps into the scope")
end

-- Cross-function goto (outer to inner label, invalid)
do
  local function inner()
    ::in_label:: return 1
  end
  local function outer()
    goto in_label
    return 0
  end
  expect_error(outer, "no visible label 'in_label'")
end

-- Cross-function goto (inner to outer label, invalid)
do
  local function outer()
    ::outer_label:: ;
    local function inner()
      goto outer_label
    end
    return inner()
  end
  expect_error(outer, "no visible label 'outer_label'")
end

-- Cross-function goto (outer after defining inner label, invalid)
do
  local function outer()
    local function inner()
      ::nested_label:: return 2
    end
    goto nested_label
  end
  expect_error(outer, "no visible label 'nested_label'")
end

-- Forward goto to label not safe end (fails)
do
  local function f()
    goto after_locals
    local a = 1
    ::after_locals:: local b = 2
    return b
  end
  expect_error(f, "jumps into the scope")
end

-- Repeat safe-end style still illegal
do
  local function f()
    repeat
      goto done
      local x = 1
      ::done:: ;
    until x == 0
  end
  expect_error(f, "jumps into the scope")
end

-- goto to correct label when nested
do goto l3; ::l3:: end -- does not loop jumping to previous label 'l3'

do
  local x
  ::L1::
  local y
  assert(y == nil)
  y = true
  if x == nil then
    x = 1
    goto L1
  else
    x = x + 1
  end
  assert(x == 2 and y == true)
end
