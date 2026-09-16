---
references:
- plugs/editor/page.ts
- plug-api/lib/ref.ts
---
At the header of each page, you see the currently open page name. Let’s call this user interface element the “Page Namer.” This element of the user interface serves a few roles:

* It indicates the **currently open name** (duh)
* Its font color indicates the current **page status**:
  * Black (in light mode) indicates the page is currently saved
  * Gray (in light mode) indicates the page is currently not saved
* By changing the page name and hitting `Enter` (or clicking/tapping outside of it) you **rename** the [[Page|page]], automatically updating all references to it as well.

If you rename a page into another folder, documents in its original folder that are linked only from that page move with it, and their links in the page are updated. Documents _also_ linked from other pages stay where they are.
