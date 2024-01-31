SilverBullet has a simple expression language that is used both by the [[Query Language]] and [[Template Language]].

Examples in this page will be demonstrated by embedding expressions inside of a [[Templates|template]].

# Primitives 
* strings: `"a string"`, `'a string'` or `a string` (with backticks). Escaping is not currently supported, so use your quotes wisely.
* numbers: `10`
* booleans: `true` or `false`
* regular expressions: `/[a-z]+/`
* null: `null`
* lists: `["value 1", 10, false]`
* attributes:
  * `.` for the current object
  * `attr` for the current object’s attribute with the name `attr`
  * `<expression>.attr` to access an attribute from the object that `<expression>` evaluates to
* variables: `@page`. Note the `@page` is always available and is an instance of a [[Objects#page]] that points to the current page.

## Examples
```template
String expression: {{"This is a string"}}
List expression: {{[1, 2, 3]}}
Attribute of variable: {{@page.name}}
```

# Function calls
* `functionName(argument1, argument2, ...)`: call function `functionName`
* `functionName`: call `functionName` without any arguments

## Examples
```template
Today with argument list: {{today()}}
Today without an argument list: {{today}}
```

## Supported functions
[[Functions]]

# Logical expressions 

* and: `name = "this" and age > 10`
* or: `name = "this" or age > 10`

## Examples
```template
Simple boolean expression: {{"pete" = "pete" or "hank" = "pete"}}
```

# Binary expressions 
* `=` equals
  * For scalar values this performs an equivalence test (e.g. `10 = 10`)
  * If the left operand is an array and the right operand is _not_, this will check if the right operand is _included_ in the left operand’s value, e.g. `[1, 2, 3] = 2` will be true.
  * If both operands are arrays, they will be compared for equivalence ignoring order, so this will be true: `[1, 2, 3] = [3, 2, 1]`
* `!=` the exact inverse of the meaning of `=`, e.g. `name != "Pete"`
* `<` less than, e.g. `age < 10`
* `<=` less than or equals, e.g. `age <= 10`
* `>` greater than, e.g. `age > 10`
* `>=` greater than or equals, e.g. `age >= 10`
* `=~` to match against a regular expression, e.g. `name =~ /^template\//`
* `!=~` to not match a regular expression, e.g. `name !=~ /^template\//`
* `in` member of a list (e.g. `prop in ["foo", "bar"]`)
* `+` addition (can also concatenate strings), e.g. `10 + 12` or `name + "!!!"`
* `-` subtraction, e.g. `10 - 12`
* `/` addition, e.g. `10 / 12`
* `*` multiplication, e.g. `10 * 12`
* `%` modulo, e.g. `10 % 12`

## Examples
```template
Some arithmatic: {{10 * 100 / 1000}}
Some regexp match: {{"hello" =~ /ell/}}
Some list check: {{["template", "other"] = "template"}}
```

# Unary expression 
* `not <expression>` or `!<expression>` to negate the truthiness value

## Examples
```template
Not false: {{!false}} and {{not false}}
```

# Ternary expressions 
* `<expression> ? <ifTrue> : <ifFalse>`

## Examples
```template
{{8 > 3 ? "8 is larger than 3" : "8 is not larger than 3"}}
```

# Comments
Line comments are supported via `# this is a line comment`

# Operator precedence
Operator precedence follows standard rules, use parentheses when in doubt, e.g. `(age > 10) or (name = "Pete")`