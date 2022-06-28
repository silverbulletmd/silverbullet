Some things I want to work on:

* [ ] Persistent recent commands (saved between sessions)
* [ ] Add ==marker== syntax
* [ ] Two finger tap gesture to bring up command palette
* [ ] Change indent level command 
* [ ] Keyboard shortcuts for specific notes (e.g. `index` note)
* [ ] RevealJS slides plug
* [ ] Pinned notes and actions?
* [ ] Template for deadline, with 📅 emoji and perhaps defaulting to today?
* [ ] Use webauthn https://www.npmjs.com/package/webauthn
* [ ] Proper sign up and login
* [ ] Data store pagination API
* [ ] Hashtag plug:
  * Higlighting
  * Page indexing/item indexing
  * Tag completion
  * Query providers: ht-page ht-item
* [ ] Extract `MarkdownEditor` component.
* REST API safeguards:
    * [ ] PUT page with `If-Last-Modified-Before` type header. Rejects if not matching. Client creates a revision, navigates to it. 
    * [ ] Put retries exponential back off