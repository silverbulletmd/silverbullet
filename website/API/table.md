These are Lua functions defined in the `table` namespace:

## table.concat(table, sep?, i?, j?)
Concatenates the elements of a table into a string using a separator.

Example:
```lua
local fruits = {"apple", "banana", "orange"}
print(table.concat(fruits, ", "))  -- prints: apple, banana, orange
print(table.concat(fruits, "", 1, 2))  -- prints: applebanana
```

## table.insert(table, pos, value)
## table.insert(table, value)
Inserts a value into a table at the specified position, shifting elements up. If position is not provided, appends the value at the end of the table.

Example:
```lua
local fruits = {"apple", "orange"}
table.insert(fruits, "banana")  -- appends at end
print(table.concat(fruits, ", "))  -- prints: apple, orange, banana

table.insert(fruits, 2, "grape")  -- inserts at position 2
print(table.concat(fruits, ", "))  -- prints: apple, grape, orange, banana
```

## table.remove(table, pos?)
Removes an element from a table at the specified position, shifting elements down. If position is not provided, removes the last element.

Example:
```lua
local fruits = {"apple", "grape", "orange", "banana"}
table.remove(fruits, 2)  -- removes "grape"
print(table.concat(fruits, ", "))  -- prints: apple, orange, banana

table.remove(fruits)  -- removes last element
print(table.concat(fruits, ", "))  -- prints: apple, orange
```

## table.sort(table, comp?)
Sorts a table in-place using the optional comparison function. Without a comparison function, sorts in ascending order.

Example:
```lua
local numbers = {3, 1, 4, 1, 5, 9}
table.sort(numbers)  -- ascending order
print(table.concat(numbers, ", "))  -- prints: 1, 1, 3, 4, 5, 9

-- Custom comparison (descending order)
table.sort(numbers, function(a, b) return a > b end)
print(table.concat(numbers, ", "))  -- prints: 9, 5, 4, 3, 1, 1
```

## table.keys(table)
Returns an array containing all the keys in the table.

Example:
```lua
local person = {name = "John", age = 30, city = "New York"}
local keys = table.keys(person)
print(table.concat(keys, ", "))  -- prints: name, age, city
```

## table.includes(table, value)
Checks if a list-table contains a specific value.

Example:
```lua
local fruits = {"apple", "banana", "orange"}
print(table.includes(fruits, "banana"))  -- prints: true
print(table.includes(fruits, "grape"))   -- prints: false
```
