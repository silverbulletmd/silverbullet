SilverBullet provides context-aware autocomplete to help you write faster. Completions are triggered automatically or via keyboard shortcuts as you type.

# Page link completion
Type `[[` to trigger page name completion. SilverBullet searches across all pages in your space and offers matching suggestions. Select one to insert a [[Link]] to that page. If no page with that name exists, a link is still created — navigating to it will create the page (these are tracked as [[Aspiring Pages]]).

# Tag completion
Type `#` to trigger tag completion. SilverBullet suggests existing tags from across your space. This helps maintain consistent tagging — no more typos creating duplicate tags.

# Emoji completion
Type `:` followed by a keyword to search for emoji. For example, `:rocket` offers the rocket emoji. Press Enter to insert it.

# Frontmatter key completion
Inside a [[Frontmatter]] block, SilverBullet suggests attribute keys that are already used elsewhere in your space. This helps keep your metadata schema consistent.

# Slash commands
Type `/` at the beginning of a line (or after a space) to trigger [[Slash Command]] completion. Slash commands can insert templates, perform actions, or trigger custom behavior defined in [[Space Lua]].

# Lua code completion
Inside `space-lua` fenced code blocks, SilverBullet provides code completion for:

* Global functions and variables
* API namespaces (`editor.`, `space.`, `index.`, etc.)
* Table fields and methods

# Custom completions
You can extend the completion system by subscribing to the `editor:complete` event via [[Space Lua]]. Your handler receives the current cursor context and can return additional completion items.

See also: [[API/event]]
