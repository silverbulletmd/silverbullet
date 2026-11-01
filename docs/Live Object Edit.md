Edit [[Frontmatter]] and [[Tag/data|data blocks]] as forms. Changes are written back to the page’s YAML and can be undone. In a read-only space, forms display their values without allowing changes.

# Editing attributes
1. Open a page with frontmatter or a data block and move the cursor out of its YAML to show the form.
2. Change a value in its field. Use the form’s attribute controls to add, remove or reorder attributes.
3. Choose **Edit source** from the ⋯ menu to edit YAML directly, or press Esc in an input to reveal its attribute. Move the cursor outside the YAML to return to the form.

On a page without frontmatter, hover over the first line to reveal the faint **add tag** icon. Clicking it opens the form with an empty tags field. Type a tag and press Enter, then use **+ add attribute** to add more attributes. [[Guide/Organize with Tags and Attributes]] shows the workflow. Undo removes your changes.

A data block can contain several objects, separated by `---`. **+ add item** appears beneath the last item once it has an attribute. **Delete** in the ⋯ menu removes one item, or the whole block if it is the only item. On frontmatter, **Delete** removes the entire frontmatter. These changes are undoable.

# Configuration
In [[Workbench/Configuration]], switch **Edit frontmatter as a form** or **Edit data blocks as a form** off to keep the corresponding YAML visible. A tag may provide its own renderer independently of these default-form settings.

For custom forms and cards, see [[API/tag#Rendering objects]] and its [[API/tag#Render context|render context reference]]. To update an object from a command or query result, use [[API/object#object.update|object.update]].
