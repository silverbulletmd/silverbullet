#meta

# Configuration
Create a [[SECRETS]] page in your space, with a YAML block:

```yaml
OPENAI_API_KEY: yourapikeyhere
```

# Implementation
```space-lua
openai = {
  Client = {}
}
openai.Client.__index = openai.Client

-- Create a new OpenAI client instance
function openai.Client.new(apiKey)
    -- Read SECRETS if no API key provided
    if not apiKey then
        local secretsPage = space.readPage("SECRETS")
        apiKey = string.match(secretsPage, "OPENAI_API_KEY: (%S+)")
    end
    if not apiKey then
        error("No OpenAI API key supplied")
    end

    local openai_lib = js.import("https://esm.sh/openai")
    local client = js.new(openai_lib.OpenAI, {
        apiKey = apiKey,
        dangerouslyAllowBrowser = true
    })

    local self = setmetatable({
        client = client
    }, OpenAIClient)
    
    return self
end

-- Chat completion method
function openai.Client:chat(message)
    local r = self.client.chat.completions.create({
        model = "gpt-4o-mini",
        messages = {
            { role = "user", content = message },
        },
    })
    return r.choices[1].message.content
end

-- Streaming chat completion method
function openai.Client:stream_chat(message)
    local r = self.client.chat.completions.create({
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
