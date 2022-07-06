Some things I want to work on:

* [ ] Persistent recent commands (saved between sessions)
* [x] Add ==marker== syntax
* [x] Two finger tap gesture to bring up command palette
* [ ] Change indent level command 
* [ ] Keyboard shortcuts for specific notes (e.g. `index` note)
* [ ] RevealJS slides plug
* [ ] Pinned notes and actions?
* [x] Template for deadline, with 📅 emoji and perhaps defaulting to today?
* [ ] Data store pagination API
* [ ] Extract `MarkdownEditor` component.
* REST API safeguards:
    * [ ] PUT page with `If-Last-Modified-Before` type header. Rejects if not matching. Client creates a revision, navigates to it. 
    * [ ] Put retries exponential back off