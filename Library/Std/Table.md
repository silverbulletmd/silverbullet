#meta
Implements utilities for working with Markdown tables

# Table
## Commands

```space-lua
command.define {
  name = "Table: Format",
  run = function()
    position = editor.getCursor()
    tree = markdown.parseMarkdown(editor.getText())
    tableNode = nodeParentOfType(tree, position, "Table")
    if tableNode then
      formatMarkdownTable(tableNode)
    else
      editor.flashNotification("This command must be run with cursor in a table", "error")
    end
  end
}
```

## Implementation

```space-lua
-- Find outermost node of given type that contains the position
-- similar to plug-api/lib/tree.ts nodeAtPos
function nodeParentOfType(tree, position, nodeType)
  if position < tree.from or position > tree.to then
    return nil
  end
  if tree.type == nodeType then
    return tree
  end
  if tree.children then
    for _, child in ipairs(tree.children) do
      if position >= child.from and position <= child.to then
        return nodeParentOfType(child, position, nodeType)
      end
    end
  end
  return nil
end
```

```space-lua
function formatMarkdownTable(tree)
  -- First find the desired length for each column
  columnLengths = {}
  columnAlignments = {}
  for _, child in ipairs(tree.children) do
    if child.type == "TableDelimiter" then
      column = 1
      for _, spec in ipairs(string.split(child.children[1].text, "|")) do
        if #spec > 0 then
          minLength = 1
          if #spec >= 2 and string.endsWith(spec, ":") then
            if string.startsWith(spec, ":") then
              columnAlignments[column] = "center"
              minLength = 3
            else
              columnAlignments[column] = "right"
              minLength = 2
            end
          else
            columnAlignments[column] = "left"
          end

          if minLength > (columnLengths[column] or 0) then
            columnLengths[column] = minLength
          end
          column = column + 1
        end
      end
    elseif child.type == "TableHeader" or child.type == "TableRow" then
      column = 1
      for i, cell in ipairs(child.children) do
        if cell.type == "TableDelimiter" then
          next = child.children[i + 1]
          if next and next.type == "TableCell" then
            len = next.to - next.from
            if len > (columnLengths[column] or 0) then
              columnLengths[column] = len
            end
          end
          
          column = column + 1
        end
      end
    end
  end
  print(columnAlignments)

  -- Then print the table using these column lengths
  output = ""
  for _, child in ipairs(tree.children) do
    if child.type == "TableDelimiter" then
      output = output .. "\n|"
      for column, len in ipairs(columnLengths) do
        align = columnAlignments[column]
        if align == "left" then
          -- This is separate case because could be shorter than 2 characters
          output = output .. string.rep("-", len)
        else
          output = output .. (align == "center" and ":" or "-") .. string.rep("-", len - 2) .. ":"
        end
        output = output .. "|"
      end
    elseif child.type == "TableHeader" or child.type == "TableRow" then
      if child.type ~= "TableHeader" then
        output = output .. "\n"
      end
      output = output .. "|"
      column = 1
      for i, cell in ipairs(child.children) do
        if cell.type == "TableDelimiter" then
          next = child.children[i + 1]
          if next and next.type == "TableCell" then
            len = next.to - next.from
            
            -- Similar to plugs/index/table.ts:concatChildrenTexts
            for _, next_child in ipairs(next.children) do
              output = output .. next_child.text
            end
            
            output = output .. string.rep(" ", columnLengths[column] - len) .. "|"
          end
          
          column = column + 1
        end
      end
    end
  end

  -- Replace the table node with the formatted content
  editor.replaceRange(tree.from, tree.to, output)
end
```
