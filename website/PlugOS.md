So here’s a secret — [[SilverBullet]] is really just a Trojan horse to test a potentially much more widely applicable idea, the idea to _make applications extensible at different levels of its stack_ in a controlled manner.

## Background
I’ve long appreciated the simplicity and flexibility of [AWS’s Lambda functions](https://aws.amazon.com/lambda/). The idea is simple: you write a function using some language (JavaScript, Python, Java or whatever floats your boat), package it up, and ship it to AWS (think: zip file). Then, you configure the triggers that invoke those functions (such as certain events), and that’s it. The rest is managed for you.

The AWS infrastructure fully manages the lifecycle of these functions: it ensures there are sufficient servers ready to invoke them, runs the code, recycles the processes when appropriate, and kills them when they misbehave. All this machinery is completely hidden from the user. It is referred to as **serverless** because it abstracts away the concept of a server. 

Of course, this requires functions to be written in a specific way:

* **Stateless:** while the runtime may keep functions running and reuse an instance to perform multiple invocations, functions have to be written without this assumption. Therefore any state needs to be maintained outside of the function.
* **Self contained:** they typically make limited assumptions on the environment other than a language runtime.
* **Short lived:** the assumption is that functions run for a limited amount of time, usually a few milliseconds, perhaps seconds, but a minute at most.

While they can perform arbitrary computations, they do have constraints:

1. They have to be stateless: while the runtime may keep functions running and reuse an instance to perform multiple invocations, they cannot assume this is the case. They have to assume that every invocation happens in a fresh environment.
2. They have limited access to the host machine, such as no direct access to a (persistent) file system.

What can these functions do? In principle, anything, while being limited to access to the host. They generally cannot write to the host’s filesystem, for instance. They also tend to be constrained in allocated run time and memory. All communication with the outside world tends to happen

Then, you configure when it should be triggered. 

This concept is not only interesting in terms of **scalability** — such a function can quickly scale to millions of invocations per second when necessary, and down to zero when that demand vanishes — but also in terms of **portability**. Couldn’t such functions conceptually run _everywhere_? And indeed, recently such functions have been moving to what’s called “the edge” as well, such as [Lambda@Edge](https://aws.amazon.com/lambda/edge/), [Vercel’s Edge Functions](https://vercel.com/blog/edge-functions-generally-available), or [Netlify’s Edge Functions](https://docs.netlify.com/edge-functions/overview/). What is the “edge” here? Generally, the closest data center these providers offer near the user. The goal? Lower latency.

But is that as _edgy_ as we can get? What about the _real_ edge: the user’s device? 

## Introducing PlugOS
PlugOS is a JavaScript (TypeScript) library that brings these concepts to _applications_: allowing applications such as [[SilverBullet]] to be extended in a safe way, by allowing plugins — named “plugs” — to _hook_ into various aspects of the application, run custom code as a result, which in turn can affect the application again via _syscalls_.

## Concepts
* _Functions_: are pieces of code, written in JavaScript or TypeScript, that add custom functionality to a hosting application.
* _Hooks_: are application-specific extension points. They can range from defining new commands to timer-based hooks (cron-like) to defining HTTP endpoints.
* _Syscalls_: expose (often) application-specific functionality to functions, allowing it to e.g. manipulate the UI, access various data stores, etc.
* _Manifests_: wire the whole thing together. They are [[YAML]] files that define the functions and what they hook into.
* _Sandbox_: each plug is run in its own sandbox. In the browser this is a [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API). On the server as well (although Deno enables [deeper sandboxing](https://deno.land/manual@v1.36.3/runtime/workers#instantiation-permissions) than the browser). Sandboxes can, in principle, be flushed out and restarted at any time. In fact, this is how _hot reloading_ of plugs is implemented.