
# Unordered lists
* Short
* [ ] This is a task 
* Long item that will wrap its line eventually when I keep typing, this will be good
  * Short sub-item
  * Longer sub-item that will eventually wrap the line when I keep typing
* [ ] Task
* [x] Done task
* [ ] Task that will eventually also wrap its line to see how this goes etc.
* Unordered list item:
  * [ ] With a task sub item
  * [ ] And a long one that will eventually wrap its line if I keep typing

# Mixed bullet markers
- Hyphen marker
* Asterisk marker
- Hyphen with a long line that will wrap to verify hanging indent works for `-` too

# Deep nesting
* Level 1
  * Level 2
    * Level 3
      * Level 4
        * Level 5
          * Level 6: deeper than previously supported
            * Level 7: long line that wraps so we can see the hanging indent at extreme depth

# Ordered lists
1. Short
2. Long item that will wrap its line eventually when I keep typing, this will be good.
  1. Short sub-item
  2. Longer sub-item that will eventually wrap the line when I keep typing
4. And a third
5. Five
6. Six
7. Seven
8. Eight
9. Nine
10. Ten: two-digit number. Can’t fully align due to width of number.
11. Eleven, wraps if I keep typing to see the hanging indent will keep going to the next line.
100. Three-digit edge case, also wider.

# Mixed ordered + unordered
1. Numbered parent
   * Unordered child
   * Another unordered child, now running over to the next line when I keep typing.
   * [ ] A task as ordered's child
* Unordered parent
  1. Numbered child
  2. Another numbered child
  3. [ ] Task inside ordered child and now what will happen when this starts to wrap. Oh it looks nice!

# Inline formatting in list items
* **Bold** text in a list
* *Italic* text and `inline code`
* A [[SilverBullet]] wiki link embedded
* A regular [external link](https://example.com) in the middle of a line
* Mix: **bold**, *italic*, `code`, [[WikiLink]], [ext](http://x) — does the wrap stay aligned?

# Task states
* [ ] Open task
* [x] Completed task
* [ ] Task with **bold** and a [[Link]] inside
* [ ] Long task with formatting: **bold**, *italic*, `code`, [[Link]] — verify wrapped lines hang correctly

# Code block inside list item
* Item with a fenced code block:
  ```js
  const x = 1;
  const y = 2;
  ```
* Next item — does alignment recover after the code block?

# Multi-paragraph list items
* First paragraph of an item.
  Second paragraph of the same item, indented two spaces in source.

* Next item — does the indent of the second paragraph match the first?

# Links section
These two should vertically align perfectly:

[[SilverBullet]]
item

A a line above a link
A line with [[SilverBullet]] in the middle and `code` and **bold** — chip should not add box width.
