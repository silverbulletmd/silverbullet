---
tags: guide
---
Live results follow changes to their data; definitions, transforms and baked output have different refresh rules.

# After editing an ordinary note
SilverBullet saves the Markdown and updates its [[Object Index]] asynchronously. A query reads indexed records, so a new task or changed attribute can take a moment to appear. Live expressions track their dependencies and reevaluate when relevant data changes. This is not a guarantee that every widget polls every external resource.

Try the [[Guide/Build Your First Query|first-query exercise]]: complete `Charge camera battery` on `Photo Walk`, return to the live unfinished-task list and allow saving and indexing to settle. That task disappears without rebuilding the query or running `System: Reload`. Uncheck it on the source page to bring it back.

Search has its own index and startup behavior. [[Search#The search index]] explains when text search may still be catching up.

# Choose the relevant refresh
* **A paragraph, task, tag or frontmatter value:** Allow saving and indexing to finish. Queries consume indexed note data.
* **A query’s filters, columns or rendering:** Use **Update page** in its builder, or finish editing the expression. The page contains the query instructions.
* **A reusable `space-lua` definition:** Run `System: Reload`, then inspect Workbench’s **Scripts** and **Console** tabs. Space-wide definitions need to be loaded again.
* **A tag transform that changes indexed objects:** Put the definition in `CONFIG`, reload it and run `Space: Reindex`. Existing records must be rebuilt under the new transform.
* **A baked section’s input data:** Use its **Update** menu or `Baked Sections: Update`. Baking writes a stored Markdown snapshot.
* **An external source used by a custom widget or script:** Follow that feature’s refresh contract. External changes may not be tracked as index dependencies.

# Reload definitions deliberately
A plain `lua` code fence displays source; it installs no definitions. A `space-lua` block defines reusable code after it is loaded. `System: Reload` reloads that code through [[API/system#system.reboot]]. It also waits for indexing and incorporates external changes to the open page. An apparently successful reload does not establish that every script loaded correctly: check errors in [[Workbench/Scripts]] and [[Workbench/Console]].

[[Space Lua/Page Lua|Page Lua]] has a separate page-local execution model; consult its reference when a calculation depends on local variables. You do not need to create a global definition to display an ordinary query.

# Reindex after changing transforms
A transform runs while an object is indexed. Changing a transform does not retroactively rewrite every stored object. Define `tag.define` transforms in [[CONFIG]], which loads before indexing, then explicitly reindex existing content after reloading the definition. See [[API/tag]] for transforms and [[Reference/Indexing Internals]] for the lifecycle. Do this in a writable space; published readers cannot rebuild someone else’s index.

# Baked output is a snapshot
A live `${…}` expression computes a result in the editor. [[Baked Sections]] stores that result as Markdown alongside its source, so other tools can read it. The stored output changes only when you update the baked section. Reopening a page or changing a source task does not automatically rebake it. The baked-section menu offers only read operations to a read-only reader.

# If the result still looks stale
Verify you are looking at the intended space and a live expression rather than a code example or baked output. Inspect the source note: was the tag attached to a task or a page? In Workbench, query the source records before adding filters. Then check **Console** for errors. [[Object Index]], [[Workbench/Query]] and [[Space Lua/Integrated Query]] describe the underlying behavior and limitations.
