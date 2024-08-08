Space Script allows you to extend SilverBullet with JavaScript from within your space using `space-script` [[Blocks]]. It’s script... in (your) [[Spaces|space]]. Get it?

> **warning** **Security**
> Space script allows for arbitrary JavaScript to be run in the client and server, there are security risks involved **if malicious users get write access to your space (folder)** or if you copy & paste random scripts from the Internet without understanding what they do.
> If this makes you very queazy, you can disable Space Script by setting the `SB_SPACE_SCRIPT` environment variable to `off`

# Creating scripts
Space scripts are defined by simply using `space-script` fenced code blocks in your space. This can happen on any [[Pages]] you like, but for organizational reasons it’s recommended you put them on [[Meta Pages]].

You will get JavaScript [[Markdown/Syntax Highlighting]] for these blocks.

Here is a trivial example:

```space-script
silverbullet.registerFunction({name: "helloYeller"}, (name) => {
  return `Hello ${name}!`.toUpperCase();
})
```

You can now invoke this function in a template or query:

```template
{{helloYeller("Pete")}}
```

Upon client and server boot, all indexed scripts will be loaded and activated. To reload scripts on-demand, use the {[System: Reload]} command (bound to `Ctrl-Alt-r` for convenience).

If you use things like `console.log` in your script, you will see this output either in your server’s logs or browser’s JavaScript console (depending on where the script will be invoked).

# Runtime Environment & API
Space script is loaded directly in the browser environment on the client, and the Deno environment on the server.

Depending on where code is run (client or server), a slightly different JavaScript API will be available. However, code should ideally primarily rely on the following explicitly exposed APIs:

* `silverbullet.registerFunction(def, callback)`: registers a custom function (see [[#Custom functions]]).
* `silverbullet.registerCommand(def, callback)`: registers a custom command (see [[#Custom commands]]).
* `silverbullet.registerEventListener`: registers an event listener (see [[#Custom event listeners]]).
* `silverbullet.registerAttributeExtractor(def, callback)`: registers a custom attribute extractor.
* Various SilverBullet syscalls, see [[#Syscalls]]

Many standard JavaScript APIs are available, such as:

* [fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) (making fetch calls directly from the browser on the client, and via Deno’s fetch implementation on the server)
* [Temporal](https://tc39.es/proposal-temporal/docs/) (implemented via a polyfill)

# Custom functions
SilverBullet offers a set of [[Functions]] you can use in its [[Template Language]]. You can extend this set of functions using space script using the `silverbullet.registerFunction` API.

Since template rendering happens on the server (except in [[Client Modes#Synced mode]]), this logic is typically executed on the server.

The `silverbullet.registerFunction` API takes two arguments:

* `def`: with currently just one option:
  * `name`: the name of the function to register
* `callback`: the callback function to invoke (can be `async` or not)

## Example
Even though a [[Functions#readPage(name)]] function already exist, you could implement it in space script as follows (let’s name it `myReadPage`) using the [space.readPage](https://jsr.io/@silverbulletmd/silverbullet/doc/syscalls/~/space.readPage) syscall:

```space-script
silverbullet.registerFunction({name: "myReadPage"}, async (name) => {
  const pageContent = await space.readPage(name);
  return pageContent;
})
```

**Note:** this could be written more succinctly, but this demonstrates how to use `async` and `await` in space script as well.

This function can be invoked as follows:

```template
{{myReadPage("internal/test page")}}
```

# Custom commands
You can also define custom commands using space script. Commands are _always_ executed on the client.

Here is an example of defining a custom command using space script:

```space-script
silverbullet.registerCommand({name: "My First Command"}, async () => {
  await editor.flashNotification("Hello there!");
});
```

You can run it via the command palette, or by pushing this [[Markdown/Command links|command link]]: {[My First Command]}

The `silverbullet.registerCommand` API takes two arguments:

* `def`:
  * `name`: Name of the command
  * `key` (optional): Keyboard shortcut for the command (Windows/Linux)
  * `mac` (optional): Mac keyboard shortcut for the command
  * `hide` (optional): Do not show this command in the command palette
  * `requireMode` (optional): Only make this command available in `ro` or `rw` mode.
* `callback`: the callback function to invoke (can be `async` or not)

# Custom event listeners
Various interesting events are triggered on SilverBullet’s central event bus. Space script can listen to these events and do something with them. 

The `silverbullet.registerEventListener` API takes two arguments:

* `def`, currently just one option:
  * `name`: Name of the event. This name can contain `*` as a wildcard.
* `callback`: the callback function to invoke (can be `async` or not). This callback is passed an object with two keys:
  * `name`: the name of the event triggered (useful if you use a wildcard event listener)
  * `data`: the event data

To discover what events exist, you can do something like the following to listen to all events and log them to the JavaScript console. Note that different events are triggered on the client and server, so watch both logs:

```space-script
silverbullet.registerEventListener({name: "*"}, (event) => {
  // To avoid excessive logging this line comment it out, uncomment it in your code code to see the event stream
  // console.log("Received event in space script:", event);
});
```

## Example
Let’s say you want to automatically add a completion date to a task whenever you complete it, the [[Plugs/Tasks]] plug emits a `task:stateChange` event you can listen to:

```space-script
silverbullet.registerEventListener({name: "task:stateChange"}, async (event) => {
  const {from, to, newState} = event.data;
  if(newState !== " ") {
    // Now dispatch an editor change to add the completion date at the end of the task
    await editor.dispatch({
      changes: {
        from: to, // insert at the end of the task
        insert: " ✅ " + Temporal.Now.plainDateISO().toString(),
      },
    });
  }
});
```

## Custom HTTP endpoints
Using the `registerEventListener` mechanism it is possible to expose custom HTTP endpoint on your SilverBullet’s server under the `/_/` prefix.

Whenever a HTTP request is sent to your SilverBullet server under this prefix, for instance `https://notes.myserver.com/_/hello` a `http:request:/hello` event is emitted. If a handler responds to it, this response will be used as the HTTP response.

> **warning** Warning
> Custom HTTP endpoints are not authenticated. If you want to add authentication, you have to do this manually, e.g. by checking for an “Authorization” header in your code.

For `http:request:*` events, the `data` key takes the shape of a EndpointRequest object, which in TypeScript is defined as follows:

```typescript
type EndpointRequest = {
  // The HTTP method, e.g. GET, POST, PUT, DELETE
  method: string;
  // The full HTTP request path, e.g. /_/hello
  fullPath: string;
  // The cleaned up request path (without the /_ prefix), e.g. /hello
  path: string;
  // URL request parameters (?name=Pete)
  query: Record<string, string>;
  // Request headers
  headers: Record<string, string>;
  // Request body
  body: any;
};
```

The callback function should then return an object in the following shape:

```typescript
type EndpointResponse = {
  // HTTP status code, e.g. 200, 404, 500
  status?: number;
  // Response headers
  headers?: Record<string, string>;
  // Response body, either a string, UInt8Array or JSON object
  body: any;
};
```

### Example
```space-script
silverbullet.registerEventListener({name: "http:request:/echo"}, (event) => {
  const req = event.data;
  // Simply echo back the request
  return {
    body: JSON.stringify(req, null, 2)
  };
});
```

You can try it out here: https://silverbullet.md/_/echo

**Note:** Since event names support wildcards, you can write event listeners to prefixes as well, e.g. `http:request:/something/*`.

# Custom attribute extractors
SilverBullet indexes various types of content as [[Objects]]. There are various ways to define [[Attributes]] for these objects, such as the [attribute: my value] syntax. However, using space script you can write your own code to extract attribute values not natively supported using the registerAttributeExtractor API.

The `silverbullet.registerAttributeExtractor` API takes two arguments:

* `def` with currently just one option:
  * `tags`: Array of tags this extractor should be applied to, could be a built-in tag such as `item`, `page`, `paragraph`, `header`, or `task`, but also any custom tags you define.
* `callback`: the callback function to invoke (can be `async` or not). This callback is passed the following arguments:
  * `text`: the text of the object to extract attributes for
  * return value: an object of attribute mappings, possibly overriding built-in ones.

Note that indexing happens on every page save. You have to run {[Space: Reindex]} to have the new attribute extractor apply across changes in your entire space.

## Example
Let’s say you want to use the syntax `✅ 2024-02-27` in a task to signify when that task was completed and strip it from the task name. Here’s an example:

* [x] I’ve done this ✅ 2024-08-07

The following attribute extractor will accomplish this: 

```space-script
silverbullet.registerAttributeExtractor({tags: ["task"]}, (text) => {
  // Find the completion date using a regular expression
  const completionRegex = /✅\s*(\w{4}-\w{2}-\w{2})/;
  const match = completionRegex.exec(text);
  if (match) { 
    // Let's patch the task name by stripping the completion date
    // First strip the checkbox bit from the text
    let taskName = text.replace(/\[[^\]]+\]\s*/, "");
    // Then remove the completion date and clean it up
    taskName = taskName.replace(completionRegex, "").trim(); 
    // That should be all
    return {
      name: taskName,
      completed: match[1]
    };
  }
});
```

Result:
```template
{{{task where page = @page.name select name, completed}}}
```

# Syscalls
The primary way to interact with the SilverBullet environment is using “syscalls”. Syscalls expose SilverBullet functionality largely available both on the client and server in a safe way.

In your space script, all syscalls are exposed via the global environment, and all return a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) with the result.

[A full list of syscall are documented here](https://jsr.io/@silverbulletmd/silverbullet/doc/syscalls/~)