local function assertEquals(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end

-- Disabling these for now, too dependent on flaky esm.sh

-- local lodash = js.import("https://esm.sh/lodash@4.17.21")

-- assertEquals(js.stringify(lodash.chunk({1, 2, 3, 4, 5, 6, 7, 8, 9, 10}, 3)), '[[1,2,3],[4,5,6],[7,8,9],[10]]')

-- local moment = js.import("https://esm.sh/moment@2.30.1")

-- local day = moment("1995-12-25");
-- assertEquals(day.format("DD-MM-YYYY"), "25-12-1995")
