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
  local columnLengths = {}
  local columnAlignments = {}
  local tableHeader = nil
  local tableDelimiter = nil
  local tableRows = {}

  -- Separate parsing from output generation and identify table parts
  for childIdx, child in ipairs(tree.children) do
    if child.type == "TableDelimiter" then
      tableDelimiter = child
      local column = 1

      -- Extract delimiter text from children
      local delimiterText = ""
      for _, delimChild in ipairs(child.children or {}) do
        if delimChild.text and string.find(delimChild.text, "-") then
          delimiterText = delimChild.text
          break
        end
      end
      -- Split by | and process only non-empty parts, but skip first/last if empty
      local parts = string.split(delimiterText, "|")
      local startIdx = (parts[1] == "") and 2 or 1
      local endIdx = (parts[#parts] == "") and (#parts - 1) or #parts

      for i = startIdx, endIdx do
        local spec = string.trim(parts[i])
        local minLength = 1
        if #spec >= 2 and string.endsWith(spec, ":") then
          if string.startsWith(spec, ":") then
            columnAlignments[column] = "center"
            minLength = 3
          else
            columnAlignments[column] = "right"
            minLength = 2
          end
        elseif string.startsWith(spec, ":") then
          columnAlignments[column] = "left_explicit"
          minLength = 2
        else
          columnAlignments[column] = "left"
        end

        if minLength > (columnLengths[column] or 0) then
          columnLengths[column] = minLength
        end
        column = column + 1
      end
    elseif child.type == "TableHeader" then
      tableHeader = child
      local column = 1
      local isFirstCell = true

      for i, cell in ipairs(child.children) do
        local cellType = cell and cell.type or "nil"
        if cell and cell.type == "TableCell" then
          -- Found a TableCell directly - get its content
          local cellContent = ""
          for _, next_child in ipairs(cell.children) do
            cellContent = cellContent .. next_child.text
          end
          local trimmedContent = string.trim(cellContent)

          -- Skip empty first cell only
          if trimmedContent ~= "" or not isFirstCell then
            isFirstCell = false
            local len = #trimmedContent

            if len > (columnLengths[column] or 0) then
              columnLengths[column] = len
            end
            column = column + 1
          end
        end
      end
      -- columnLengths now contains width of each header column
    elseif child.type == "TableRow" then
      table.insert(tableRows, child)
      local column = 1
      local isFirstCell = true
      for i, cell in ipairs(child.children) do
        if cell and cell.type == "TableCell" then
          -- Get actual content length after trimming
          local cellContent = ""
          for _, next_child in ipairs(cell.children) do
            cellContent = cellContent .. next_child.text
          end
          local trimmedContent = string.trim(cellContent)

          -- Skip empty first cell only
          if trimmedContent ~= "" or not isFirstCell then
            isFirstCell = false
            local len = #trimmedContent

            if len > (columnLengths[column] or 0) then
              columnLengths[column] = len
            end
            column = column + 1
          end
        end
      end
    end
  end

  -- Helper function to format table row (one)
  local function formatTableRow(child)
    local rowOutput = "|"
    local column = 1
    local isFirstCell = true
    for i, cell in ipairs(child.children) do
      if cell and cell.type == "TableCell" then
        -- Get cell content
        local cellContent = ""
        for _, next_child in ipairs(cell.children) do
          cellContent = cellContent .. next_child.text
        end

        cellContent = string.trim(cellContent)

        -- Skip empty first cell only
        if cellContent ~= "" or not isFirstCell then
          isFirstCell = false
          local len = #cellContent

          -- Add exactly 1 space on each side (ignore alignment for content rows)
          rowOutput = rowOutput .. " " .. cellContent .. " |"

          column = column + 1
        end
      end
    end
    return rowOutput
  end


  -- Output in order: Header -> Delimiter -> Rows
  local output = ""

  if tableHeader then
    output = formatTableRow(tableHeader)
  end

  if tableDelimiter then
    if #output > 0 then
      output = output .. "\n"
    end
    output = output .. "|"
    for column, len in ipairs(columnLengths) do
      local align = columnAlignments[column]
      if align == "left" then
        output = output .. " " .. string.rep("-", len) .. " |"
      elseif align == "left_explicit" then
        output = output .. " :" .. string.rep("-", len - 1) .. " |"
      else
        output = output .. " " .. (align == "center" and ":" or "-") .. string.rep("-", len - 2) .. ": |"
      end
    end
  end

  for _, row in ipairs(tableRows) do
    if #output > 0 then
      output = output .. "\n"
    end
    output = output .. formatTableRow(row)
  end


  -- Replace the table node with the formatted content
  editor.replaceRange(tree.from, tree.to, output)
end
```
