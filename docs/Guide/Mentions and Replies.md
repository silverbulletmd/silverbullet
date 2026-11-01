#guide

Use mentions to address someone in a shared space, and signatures to show who wrote a request or reply. This exercise needs write access. Sam and Jo work together on the fictional photo-management application Moonshot.

# Send a request
On a practice page called `Moonshot Review`, write:

```markdown
@jo Please check the Moonshot import instructions. -- @sam
```

`@jo` addresses Jo. The trailing `-- @sam` credits Sam and does not create a request for Sam. Use account usernames in a real shared space; typing an arbitrary name creates an [[Identity]], but does not create an [[Account]] or grant access.

# Find and answer it
1. Run `Navigate: Mentions`, or click a mention to open the Mention Inbox.
2. Select the recipient from the dropdown. The inbox normally starts with your own identity and groups entries by page.
3. Open the request and write the answer beside it. To address Sam explicitly, Jo can write:

```markdown
@sam The import instructions are ready for review. -- @jo
```

Use `Mention: Sign` or `/sign` to sign the current block as yourself. Signing alone credits the reply; include an ordinary mention when the reply should appear in someone’s inbox. An owner-only deployment without account usernames uses `@self` for signing.

# Resolve a request
After handling a request, choose **Remove mention** on its inbox row to remove its `@name` from the source while keeping the surrounding text. **Delete task/item/paragraph** removes the containing content and asks for confirmation. These actions require write access. If the page changed since indexing, reopen the mention and retry.

For a completed task, mark its checkbox done. For a page addressed through `recipients:` frontmatter, edit that field to remove a recipient; the inline mention removal actions do not apply to frontmatter rows. The inbox refreshes after indexing.

# Choose the right notation
* `[[Jo]]` links to a page; it does not address an identity.
* `@jo` addresses an identity and contributes a [[Recipient|recipient]] relation.
* `-- @jo`, `— @jo` and `– @jo` at the end of a line sign a block. A single hyphen and `(@jo)` are not signatures.
* `authors:` credits the page, without attributing unsigned body text.
* Account attribution in [[Revisions]] records who changed files. A typed signature is self-declared and provides no authentication.

See [[At-Mention]], [[Recipient]], [[Authorship]] and [[Identity]] for syntax, indexing and API details. Comments can hold an exchange without making it part of the main prose; see [[Markdown/Comment]].
