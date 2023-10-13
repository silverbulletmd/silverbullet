#plug

> **Warning** Deprecated
> Directives are now deprecated and will likely soon be removed, use [[Live Templates]] and [[Live Queries]] instead.


The directive plug is a built-in plug implementing various so-called “directive” that all take the form of `<!-- #directiveName ... -->` and close with `<!-- /directiveName -->`. Currently the following directives are supported:

* `#query` to perform queries: [[Live Queries]]
* `#include` to inline the content of another page verbatim: [[@include]]
* `#use` to use the content of another as a [handlebars](https://handlebarsjs.com/) template: [[@use]]
* `#eval` to evaluate an arbitrary JavaScript expression and inline the result: [[@eval]]


## Include
$include
The `#include` directive can be used to embed another page into your existing one. The syntax is as follows:

    <!-- #include [[page reference]] -->
    
    <!-- /include -->

Whenever the directives are updated, the body of the directive will be replaced with the latest version of the reference page. 

## Use
$use
The `#use` directive can be used to use a referenced page as a handlebars template. Optionally, a JSON object can be passed as argument to the template:

    <!-- #use [[template/plug]] {"name": "🔌 Directive", "repo": "https://google.com", "author": "Pete"} -->
    
    <!-- /use -->

which renders as follows:
<!-- #use [[template/plug]] {"name": "🔌 Directive", "repo": "https://google.com", "author": "Pete"} -->
* [[🔌 Directive]] by **Pete** ([repo](https://google.com))
<!-- /use -->
* [ ] #test This is a test task

Note that a string is also a valid JSON value:

So, for instance, a template can take a tag name as an argument:

    <!-- #use [[template/tagged-tasks]] "test" -->
    * [ ] [[🔌 Directive@1537]] This is a test task  #test
    <!-- /use -->
