---
tags: api/syscall maturity/experimental
references:
- libraries/Library/Std/APIs/Capture.md
- client/plugos/syscalls/capture.ts
- client/capture/types.ts
---
APIs to handle links, text and files shared into SilverBullet from the operating system share sheet (currently Android).

When something is shared into a space, SilverBullet shows an editable draft and offers the actions defined as [[Service|services]] with the `capture` selector. Each action is a `service.define` call with a `match` and a `run` function, see [[^Library/Std/APIs/Capture]] for the full description and the bundled **Save as Quick Note** action, which you can hide by setting `capture.quickNote` to `false`.

Both `match` and `run` receive the draft as a table with:
* `id`: unique ID of this capture
* `receivedAt`: time the share arrived, in milliseconds since the epoch
* `title`, `text`, `url`: shared values (empty strings when absent)
* `files`: list of shared files, each with a `handle`, `name`, `type` (MIME type) and `size` (in bytes)

`match` returns `nil` to hide the action for this draft, or a table with `name`, `description` and optional `priority`. `run` receives the draft as edited by the user. If `run` fails, the draft stays pending so it can be retried; when it succeeds, the draft is removed.

The functions below read the shared files. They only work inside the `run` function of the capture action that is running. `capture.saveFile` raises an error for an invalid path, a file larger than `maximumDocumentSize`, or an existing file with different content.

> **success** Success
> Put your capture actions in a `space-lua` block, e.g. on your [[CONFIG]] page.

# Example
```lua
service.define {
  selector = "capture",
  match = function(data)
    if #data.files == 0 then return nil end
    return { name = "Save to Attachments", description = "Store shared files under Attachments/" }
  end,
  run = function(data)
    for _, file in ipairs(data.files) do
      capture.saveFile(file.handle, "Attachments/" .. data.id .. "-" .. file.name)
    end
  end,
}
```

# API
<!--#lua spacelua.renderApiDocumentation("capture") -->
## capture.readFile

`capture.readFile(handle)`

Reads a staged file belonging to the current capture action.

**Parameters:**

- `handle` (`string`) — File handle from the capture.

**Returns:**

- `byteArray` — File bytes.

**Example:**

```lua
local bytes = capture.readFile(data.files[1].handle)
```

## capture.saveFile

`capture.saveFile(handle, path)`

Saves a staged file without overwriting different bytes. Returns true when newly created and false when identical content already exists.

**Parameters:**

- `handle` (`string`) — File handle from the capture.
- `path` (`string`) — New document path.

**Returns:**

- `boolean` — true when the file was created, false when identical bytes already exist.

**Example:**

```lua
capture.saveFile(data.files[1].handle, "Inbox/" .. data.files[1].name)
```
<!--/lua-->
