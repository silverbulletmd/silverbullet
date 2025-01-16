#meta

# Configuration
Create a [[SECRETS]] page in your space, with a YAML block:

```yaml
OPENAI_API_KEY: yourapikeyhere
```

# Implementation
```space-lua
openai = {}

-- Initialize OpenAI, optionally OPENAI_API_KEY from your SECRETS page if not supplied directly
function openai.init(openaiApiKey)
  if openai.client then
    -- Already initialized
    return
  end
  if not openaiApiKey then
    -- Read SECRETS
    local secretsPage = space.readPage("SECRETS")
    -- Find the line with the pattern OPENAI_API_KEY: <key> and extract the key
    openaiApiKey = string.match(secretsPage, "OPENAI_API_KEY: (%S+)")
  end
  if not openaiApiKey then
    error("No OpenAI API key supplied")
  end
  
  local openai_lib = js.import("https://esm.sh/openai")
  openai.client = js.new(openai_lib.OpenAI, {
      apiKey = openaiApiKey,
      dangerouslyAllowBrowser = true
  })
end

function openai.ensure_inited()
  if not openai.client then
    error("OpenAI not yet initialized")
  end
end

function openai.chat(message)
  openai.ensure_inited()
  local r = openai.client.chat.completions.create({
    model = "gpt-4o-mini",
    messages = {
        { role = "user", content = message },
    },
  })
  return r.choices[1].message.content
end


function openai.stream_chat(message)
  openai.ensure_inited()
  local r = openai.client.chat.completions.create({
    model = "gpt-4o-mini",
    messages = {
        { role = "user", content = message },
    },
    stream = true,
  })
  local iterator = js.each_iterable(r)
  return function()
    local el = iterator()
    if el then
      return el.choices[1].delta.content
    end
  end
end

```
