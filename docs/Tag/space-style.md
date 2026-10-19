---
description: Space Style CSS blocks, applied to the client.
tagKind: system
references:
- plugs/index/space_style.ts
---
Every `space-style` block across your space is indexed with the `space-style` tag, and their CSS is applied to the client, ordered by priority. See [[Space Style]] for how to write them.

Like [[Tag/space-lua|space-lua]] blocks, `space-style` blocks configure SilverBullet rather than hold content, so you can't attach tags to them. Commenting a block out turns it off.

## Attributes
* `ref`: the page the block is on and its position, as `page@pos`.
* `style`: the CSS text of the block.
* `priority`: the number from a `/* priority: <n> */` comment in the block, if any.
* `range`: `[start, end]` offsets of the block's code within its page.

Example query, listing every style block in this space:

${query[[from index.objects("space-style") select {ref=ref, priority=priority}]]}
