#meta/api

Useful date and time APIs as well as slash commands by default in `YYYY-MM-dd` format with times in `HH:mm:ss` (24h) format. 

Included slash commands:

* `/today` for today's date.
* `/tomorrow` for tomorrow's date.
* `/yesterday` for yesterday's date.

# Examples
Today: ${date.today()} and ${date.time()}

# Implementation
```space-lua
-- priority: 10

local DAY_SECONDS = 60 * 60 * 24

date = {
  date_format = "%Y-%m-%d",
  time_format = "%H:%M:%S",
}

--- Returns today's date, formatted with `date.date_format` (`YYYY-MM-DD` by default).
--- @return string the date
function date.today()
  return os.date(date.date_format)
end

--- Returns tomorrow's date, formatted with `date.date_format` (`YYYY-MM-DD` by default).
--- @return string the date
function date.tomorrow()
  return os.date(date.date_format, os.time() + DAY_SECONDS)
end

--- Returns yesterday's date, formatted with `date.date_format` (`YYYY-MM-DD` by default).
--- @return string the date
function date.yesterday()
  return os.date(date.date_format, os.time() - DAY_SECONDS)
end

--- Returns the current time, formatted with `date.time_format` (`HH:MM:SS`, 24h, by default).
--- @return string the time
function date.time()
  return os.date(date.time_format)
end

slashCommand.define {
  name = "today",
  run = function()
    editor.insertAtCursor(date.today())
  end
}

slashCommand.define {
  name = "yesterday",
  run = function()
    editor.insertAtCursor(date.yesterday())
  end
}

slashCommand.define {
  name = "tomorrow",
  run = function()
    editor.insertAtCursor(date.tomorrow())
  end
}
```
