local function assertEqual(a, b, message)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b .. " " .. message)
    end
end

lume = lume or {}

local getiter = function(x)
  if lume.isarray(x) then
    return ipairs
  elseif type(x) == "table" then
    return pairs
  end
  error("expected table", 3)
end

function lume.isarray(x)
  return type(x) == "table" and x[1] ~= nil
end

function lume.concat(...)
  local rtn = {}
  for i = 1, select("#", ...) do
    local t = select(i, ...)
    if t ~= nil then
      local iter = getiter(t)
      for _, v in iter(t) do
        rtn[#rtn + 1] = v
      end
    end
  end
  return rtn
end

local r = lume.concat({1, 2}, {3, 4})
assertEqual(#r, 4)
assertEqual(r[1], 1)
assertEqual(r[4], 4)