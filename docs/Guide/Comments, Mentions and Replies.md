#guide

Use comments to discuss a page alongside its main text, mentions to address someone, and signatures to show who wrote a request or reply. Adding comments and replies requires write access.

# Add a comment
SilverBullet leverage’s HTML-style [[Markdown/Comment]] syntax to add comments:
```markdown
<!--
Hello world!
-->
```

Which _Live Previews_ as follows:
<!--
Hello world!
-->

For convenience, a few (slash) commands are available to make adding comments easier.

Put the cursor in the paragraph you want to discuss and run **Comment: Add** from the command palette, or use `/comment` on a new line. SilverBullet inserts a comment after the current block. If you select text first, **Comment: Add** quotes it inside the new comment.

# Send a request
Inside a comment you can use [[At-Mention|at-mentions]]:

```markdown
@reviewer Please check this section. -- @author
```

`@reviewer` addresses the recipient. The trailing `-- @author` credits the writer without addressing them. Use account usernames in a real shared space. Typing an arbitrary name creates an [[Identity]] on the fly.

# Find and answer it
1. Run `Navigate: Mentions`, or click a mention to open the _Mention Inbox_.
2. Select the recipient from the dropdown. The inbox normally starts with your own identity and groups entries by page.
3. Open the request and write the answer underneath. Mention the original writer if the reply should appear in their inbox:

```markdown
@author This section is ready for review. -- @reviewer
```

Use `Mention: Sign` or `/sign` to sign the current block as yourself. Signing alone credits the reply.

# Resolve a comment or request
Click **Resolve** on a comment to delete the whole comment, including its replies. Copy any decisions you want to keep into the page’s main text first.

To keep the discussion but clear a request from the inbox, choose **Remove mention** on its inbox row to remove its `@name` from the source while keeping the surrounding text. **Delete task/item/paragraph** removes the containing content and asks for confirmation. These actions require write access. If the page changed since indexing, reopen the mention and retry.

For a completed task, mark its checkbox done. For a page addressed through `recipients:` frontmatter, edit that field to remove a recipient.

# Choose the right notation
* `[[Person]]` links to a page. It does not address an identity.
* `@reviewer` addresses an identity and contributes a [[Recipient|recipient]] relation.
* `-- @reviewer`, `— @reviewer` and `– @reviewer` at the end of a line sign a block. A single hyphen and `(@reviewer)` are not signatures.
* `authors:` credits the page, without attributing unsigned body text.
* Account attribution in [[Revisions]] records who changed files. A typed signature is self-declared and provides no authentication.

See [[Markdown/Comment]], [[At-Mention]], [[Recipient]], [[Authorship]] and [[Identity]] for syntax, indexing and API details.
