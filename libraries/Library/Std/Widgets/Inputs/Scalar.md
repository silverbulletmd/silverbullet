---
description: Scalar controls and shared text editing behavior.
tags: meta
---
Scalar controls and shared text editing behavior. Internal implementation of [[Library/Std/Widgets/Inputs]].

```space-lua
-- priority: 40
widgets = widgets or {}
local linkSegments = widgets.inputCompletion.linkSegments
local hasLinks = widgets.inputCompletion.hasLinks
local linkPrefix = widgets.inputCompletion.linkPrefix
local insertLink = widgets.inputCompletion.insertLink
local filterOptions = widgets.inputCompletion.filterOptions
local linkOptionsFetcher = widgets.inputCompletion.linkOptionsFetcher

local dropdown = widgets.inputMenus.dropdown

local function plain(text)
  return dom.span { class = "sb-in-plain", dom.text(text or "") }
end

local function preventDefault(e) e.preventDefault() end

local function autogrow(ta)
  ta.style.height = "auto"
  local h = ta.scrollHeight
  -- Detached (not yet rendered) nodes measure 0; CSS field-sizing covers them
  if h and h > 0 then
    ta.style.height = tostring(h + ta.offsetHeight - ta.clientHeight) .. "px"
  else
    ta.style.height = ""
  end
end

local function placeCaretAtEnd(ta)
  -- Clamped to the text's length
  ta.setSelectionRange(1000000, 1000000)
end

-- Text with its wikilinks as links that navigate
local function linkedText(text)
  local nodes = {}
  for _, segment in ipairs(linkSegments(text)) do
    if segment.link then
      table.insert(nodes, dom.a {
        class = "sb-wiki-link sb-in-link",
        href = "#",
        title = segment.target,
        -- Keeps a click from switching the field to editing
        onmousedown = preventDefault,
        onclick = function(e)
          e.preventDefault()
          e.stopPropagation()
          editor.navigate(segment.target)
        end,
        dom.text(segment.label),
      })
    else
      table.insert(nodes, dom.text(segment.text))
    end
  end
  return nodes
end

-- What Enter does in a text field: "commit", or "newline" with Shift (the
-- textarea's own behavior, so the caret and autogrow just work)
local function enterAction(e)
  if e.key ~= "Enter" or e.isComposing then return nil end
  return e.shiftKey and "newline" or "commit"
end

-- A wrapping, auto-growing textarea. `onCommit(text)` runs on Enter and on
-- change, once per distinct value; `onKey(e)` may handle a key first. With
-- `links`, typing `[[` completes pages and anchors, and the result of
-- `linkField` shows links when not editing
local function textArea(opts)
  local last = opts.value or ""
  local ta, list
  local allLinkOptions = linkOptionsFetcher()
  local function commit()
    local text = ta.value
    if text == last then return end
    last = text
    ta.setAttribute("data-sb-committed", text)
    opts.onCommit(text)
  end
  local function prefix()
    return linkPrefix(ta.value, ta.selectionStart)
  end
  local generation = 0
  local function suggest()
    generation = generation + 1
    local mine = generation
    if not prefix() then return list.hide() end
    local options = allLinkOptions()
    -- Fetching the first time takes a while; a newer keystroke wins
    if mine ~= generation then return end
    local p = prefix()
    if not p then return list.hide() end
    list.show(filterOptions(options, p.typed, nil, nil), 1)
  end
  local function accept(item)
    local p = prefix()
    list.hide()
    if not p then return end
    local text, caret = insertLink(ta.value, ta.selectionStart, p, item.value)
    ta.value = text
    ta.setSelectionRange(caret, caret)
    autogrow(ta)
  end
  ta = dom.textarea {
    class = "sb-in-text",
    rows = "1",
    placeholder = opts.placeholder,
    oninput = function()
      autogrow(ta)
      if list then suggest() end
    end,
    onfocus = function() autogrow(ta) end,
    onblur = function() if list then list.hide() end end,
    -- The caret left the `[[…` (arrows, Home/End, a click): no completion
    onkeyup = function() if list and list.open and not prefix() then list.hide() end end,
    onclick = function() if list and list.open and not prefix() then list.hide() end end,
    onchange = commit,
    onkeydown = function(e)
      if list and list.open and not e.isComposing then
        local key = e.key
        if key == "ArrowDown" or key == "ArrowUp" then
          e.preventDefault()
          return list.move(key == "ArrowDown" and 1 or -1)
        elseif key == "Enter" or key == "Tab" then
          local item = list.selected()
          if item then
            e.preventDefault()
            return accept(item)
          end
        elseif key == "Escape" then
          -- Only this closes; Esc with no list open goes on to the page
          e.preventDefault()
          return list.hide()
        end
      end
      if opts.onKey and opts.onKey(e) then return end
      if enterAction(e) == "commit" then
        e.preventDefault()
        commit()
      end
    end,
  }
  if opts.links then list = dropdown(accept) end
  ta.value = last
  -- What the page has; while the text differs, undo is the field's own
  ta.setAttribute("data-sb-committed", last)
  js.window.requestAnimationFrame(function() autogrow(ta) end)
  return ta, list
end

-- Shows the links in `ta`'s text as links while it isn't being edited (only
-- when there are any); a click elsewhere in it edits the text
local function linkField(ta, list)
  local display
  local wrapper
  local function showLinks()
    if not hasLinks(ta.value) then
      wrapper.classList.remove("sb-in-show-links")
      return
    end
    display.replaceChildren(table.unpack(linkedText(ta.value)))
    wrapper.classList.add("sb-in-show-links")
  end
  local function edit()
    if not wrapper.classList.contains("sb-in-show-links") then return end
    wrapper.classList.remove("sb-in-show-links")
    ta.focus()
    ta.setSelectionRange(#ta.value, #ta.value)
    autogrow(ta)
  end
  display = dom.span {
    class = "sb-in-linktext",
    tabindex = "0",
    onfocus = edit,
    onmousedown = function(e)
      -- A link navigates instead
      if e.target.closest("a") then return end
      e.preventDefault()
      edit()
    end,
  }
  wrapper = dom.span { class = "sb-in-linkfield", display, ta, list and list.node }
  ta.addEventListener("blur", function()
    -- After the blur settles: a pick from the list keeps focus here
    js.window.setTimeout(function()
      if js.window.document.activeElement ~= ta then showLinks() end
    end, 0)
  end)
  showLinks()
  return wrapper
end

-- Shows a field that may be in link display mode as its textarea
local function editField(ta)
  local wrapper = ta.parentElement
  if wrapper and wrapper.classList.contains("sb-in-show-links") then
    wrapper.classList.remove("sb-in-show-links")
  end
end

-- Widgets

-- Read-only text, with its links as links unless `links` is off
local function plainText(text, links)
  if links == false then return plain(text) end
  return dom.span { class = "sb-in-plain", linkedText(text or "") }
end

--- A text field that wraps long values and grows to fit them, with `[[links]]` shown as links and `[[` completion. Enter commits; Shift-Enter inserts a newline.
--- @param opts table { value?: string, onChange: function(text), readOnly?: boolean, placeholder?: string, links?: boolean (default true) }
--- @return table an inline widget
--- @see API/widgets
function widgets.textInput(opts)
  local text = opts.value ~= nil and tostring(opts.value) or ""
  if opts.readOnly then return plainText(text, opts.links) end
  local links = opts.links ~= false
  local ta, list = textArea {
    value = text,
    placeholder = opts.placeholder,
    links = links,
    onCommit = opts.onChange,
  }
  if not links then return ta end
  return linkField(ta, list)
end

--- A number field; `onChange` receives a number, or nil when cleared.
--- @param opts table { value?: number, onChange: function(number), readOnly?: boolean, placeholder?: string }
--- @return table an inline widget
--- @see API/widgets
function widgets.numberInput(opts)
  local text = opts.value ~= nil and tostring(opts.value) or ""
  if opts.readOnly then return plain(text) end
  return dom.input {
    type = "number",
    step = "any",
    class = "sb-in-number",
    value = text,
    ["data-sb-committed"] = text,
    placeholder = opts.placeholder,
    onchange = function(e)
      local typed = e.target.value
      e.target.setAttribute("data-sb-committed", typed)
      if typed == "" then
        -- An unparseable entry reads as "", which must not clear the value
        if e.target.validity.badInput then return end
        opts.onChange(nil)
      else
        opts.onChange(tonumber(typed))
      end
    end,
  }
end

--- A checkbox; `onChange` receives true or false.
--- @param opts table { value?: boolean, onChange: function(checked), readOnly?: boolean }
--- @return table an inline widget
--- @see API/widgets
function widgets.booleanInput(opts)
  if opts.readOnly then
    return plain(opts.value ~= nil and tostring(opts.value) or "")
  end
  return dom.input {
    type = "checkbox",
    class = "sb-in-boolean",
    checked = opts.value == true and "checked" or nil,
    onchange = function(e) opts.onChange(e.target.checked) end,
  }
end

local function isLeapYear(y)
  return y % 4 == 0 and (y % 100 ~= 0 or y % 400 == 0)
end
local monthDays = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 }

-- Why `text` isn't a YYYY-MM-DD calendar date, or nil when it is
local function isoDateProblem(text)
  text = tostring(text or "")
  local y, m, d = text:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
  if not y then return "Use YYYY-MM-DD" end
  y, m, d = tonumber(y), tonumber(m), tonumber(d)
  if m < 1 or m > 12 then return "There is no month " .. m end
  local days = monthDays[m]
  if m == 2 and isLeapYear(y) then days = 29 end
  if d < 1 or d > days then
    return "There is no day " .. d .. " in " .. text:sub(1, 7)
  end
  return nil
end

local calendarIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>'

-- A text field holding the ISO date, so dates never show in the browser's
-- locale format, plus a button opening the native picker
--- A date field holding `YYYY-MM-DD`, with a calendar button; `onChange` receives the date string, or nil when cleared.
--- @param opts table { value?: string, onChange: function(date), readOnly?: boolean, placeholder?: string }
--- @return table an inline widget
--- @see API/widgets
function widgets.dateInput(opts)
  local value = opts.value
  if type(value) == "userdata" and value.toISOString then
    value = value.toISOString()
  end
  value = type(value) == "string" and value:sub(1, 10) or ""
  if opts.readOnly then return plain(value) end
  local last = value
  local text, picker
  local function commit(typed)
    typed = typed:match("^%s*(.-)%s*$")
    local problem = typed ~= "" and isoDateProblem(typed) or nil
    text.classList.toggle("sb-in-invalid", problem ~= nil)
    text.title = problem or ""
    -- Picking the date it last held must still fire a change
    if problem or typed == "" then picker.value = "" else picker.value = typed end
    if problem or typed == last then return end
    last = typed
    text.setAttribute("data-sb-committed", typed)
    if typed == "" then return opts.onChange(nil) end
    opts.onChange(typed)
  end
  text = dom.input {
    type = "text",
    class = "sb-in-date",
    value = value,
    ["data-sb-committed"] = value,
    placeholder = opts.placeholder,
    spellcheck = "false",
    autocomplete = "off",
    autocapitalize = "off",
    autocorrect = "off",
    onchange = function(e) commit(e.target.value) end,
  }
  -- A real, transparent date input over the calendar icon: a tap lands on
  -- it, so iOS opens its date wheel itself; elsewhere a click asks for the
  -- picker (a direct user gesture, as showPicker needs)
  picker = dom.input {
    type = "date",
    class = "sb-in-date-picker",
    tabindex = "-1",
    title = "Pick a date",
    ["aria-label"] = "Pick a date",
    value = isoDateProblem(value) == nil and value or "",
    onclick = function()
      if picker.showPicker then pcall(function() picker.showPicker() end) end
    end,
    onchange = function(e)
      local picked = e.target.value
      if picked == "" then return end
      text.value = picked
      commit(picked)
    end,
  }
  local button = dom.span {
    class = "sb-in-date-button",
    widget.html(calendarIcon),
    picker,
  }
  return dom.span { class = "sb-in-date-field", text, button }
end

--- A dropdown over a list of values; `onChange` receives the picked value, or nil for the empty choice.
--- @param opts table { options: table, value?: any, onChange: function(value), readOnly?: boolean }
--- @return table an inline widget
--- @see API/widgets
function widgets.selectInput(opts)
  local values = opts.options or {}
  if opts.readOnly then
    return plain(opts.value ~= nil and tostring(opts.value) or "")
  end
  local options = { dom.option { value = "", dom.text("—") } }
  for _, v in ipairs(values) do
    table.insert(options, dom.option {
      value = tostring(v),
      selected = (opts.value ~= nil and tostring(v) == tostring(opts.value)) and "selected" or nil,
      dom.text(tostring(v)),
    })
  end
  return dom.select {
    class = "sb-in-select",
    onchange = function(e)
      local text = e.target.value
      for _, v in ipairs(values) do
        if tostring(v) == text then return opts.onChange(v) end
      end
      opts.onChange(nil)
    end,
    options,
  }
end


widgets.inputText = {
  plainText = plainText,
  textArea = textArea,
  linkField = linkField,
  editField = editField,
  placeCaretAtEnd = placeCaretAtEnd,
  autogrow = autogrow,
  enterAction = enterAction,
}

widgets.inputDate = {
  isoDateProblem = isoDateProblem,
}
```
