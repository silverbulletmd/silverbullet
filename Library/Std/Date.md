#meta

Date and time APIs

```space-lua
-- priority: 10

local DAY_SECONDS = 60 * 60 * 24

date = {
  date_format = "%Y-%m-%d",
  time_format = "%H:%M:%S",
}

function date.today()
  return os.date(date.date_format)
end

function date.tomorrow()
  return os.date(date.date_format, os.time() + DAY_SECONDS)
end

function date.yesterday()
  return os.date(date.date_format, os.time() - DAY_SECONDS)
end

function date.time()
  return os.date(date.time_format)
end
```

# Examples
Today: ${date.today()} and ${date.time()}