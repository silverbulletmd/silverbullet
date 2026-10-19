---
description: "The `@name` mentions across the space."
tagKind: index
references:
- plugs/index/relation.ts
- plugs/index/identity.ts
---
Every `@name` [[At-Mention|mention]] in your space produces an `identity` record for that [[Identity]] on the page where it is mentioned. Identities are names, not pages: there is never a page behind one, and an at-mention is recorded as a [[Tag/relation|relation]] with `kind: "at-mention"` and `toTag: "identity"`.

## Attributes
* `ref`: the name's namespaced `@name` identifier, the same value at-mention relations use as `to`.
* `name`: the name as written, without the `@`.
* `page`: the page the name is mentioned on.

Example query, listing every name mentioned in this space:

${query[[from index.objects("identity") select {name=name, page=page}]]}
