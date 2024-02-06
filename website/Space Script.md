Space Script allows you to extend SilverBullet with JavaScript from within your space using `space-script` [[Blocks]]. It’s script... in (your) [[Spaces|space]]. Get it?

> **warning** **Experimental**
> This is an experimental feature that is under active development and consideration. Its APIs are likely to evolve, and the feature could potentially be removed altogether. Feel free to experiment with it and give feedback on [our community](https://community.silverbullet.md/).

> **warning** **Security**
> Space script allows for arbitrary JavaScript to be run in the client and server, there are security risks involved **if malicious users get write access to your space (folder)** or if you copy & paste random scripts from the Internet without understanding what they do.
> If this makes you very queazy, you can disable Space Script by setting the `SB_SPACE_SCRIPT` environment variable to `off`

# Creating scripts
Space scripts are defined by simply using `space-script` fenced code blocks in your space. You will get JavaScript [[Markdown/Syntax Highlighting]] for these blocks.

Here is a trivial example:

```space-script
silverbullet.registerFunction("helloSayer", (name) => {
  return `Hello ${name}!`;
})
```

You can now invoke this function as follows:

```template
{{helloSayer("Pete")}}
```

Upon client and server boot, all indexed scripts will be loaded and activated. To reload scripts on-demand, use the {[System: Reload]} command (bound to `Ctrl-Alt-r` for convenience).

If you use things like `console.log` in your script, you will see this output either in your server’s logs or browser’s JavaScript console (depending on how the script will be invoked).

# Runtime Environment & API
Space script is loaded both in the client and server (or only client, if you run in [[Install/Configuration#Security]] `SB_SYNC_ONLY` mode).

Depending on where code is run, a slightly different JavaScript API will be available. However, code should ideally primarily rely on the following explicitly exposed APIs:

* `silverbullet.registerFunction(name, callback)`: register a custom function (see below)
* `syscall(name, args...)`: invoke a syscall

Many other standard JavaScript APIs are also available, such as:

* [fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
* [Temporal](https://tc39.es/proposal-temporal/docs/)

# Custom functions
SilverBullet offers a set of [[Functions]] you can use in its [[Template Language]]. You can extend this set of functions using space script using the `silverbullet.registerFunction` API.

Here is a simple example:

```space-script
silverbullet.registerFunction("helloSayer", (name) => {
  return `Hello ${name}!`;
})
```

You can now invoke this function as follows:

```template
{{helloSayer("Pete")}}
```

Even though a [[Functions#readPage(name)]] function already exist, you could implement it in Space Script as follows (let’s name it `myReadPage` instead) using the `syscall` API (detailed further in [[#Syscalls]]):

```space-script
silverbullet.registerFunction("myReadPage", async (name) => {
  const pageContent = await syscall("space.readPage", name);
  return pageContent;
})
```

Note: this could be written more succinctly, but this demonstrates how to use `async` and `await` in space script as well.

This function can be invoked as follows:

```template
{{myReadPage("internal/test page")}}
```

# Syscalls
You can invoke syscalls to get access to various useful SilverBullet APIs. A syscall is invoked via `syscall(name, arg1, arg2)` and returns a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) with the result.

```template
{{#each @module in {syscall select replace(name, /\.\w+$/, "") as name}}}
## {{@module.name}}
{{#each {syscall where @module.name = replace(name, /\.\w+$/, "")}}}
* `{{name}}`
{{/each}}
{{/each}}
```
