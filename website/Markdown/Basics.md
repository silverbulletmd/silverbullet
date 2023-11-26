The idea of markdown is that you write plain text with some additional markup that even without further processing (like rendering it to HTML, or [[Live Preview]]) you could just read and understand. It was inspired by conventions used in plain-text e-mails, before e-mail supported rich formatting.

# Basic markup

To write markdown, you just write text. But then to emphasize something you can add `_underscores_` around a phrase to make look _italic_, or `**asterisks**` to make it **bold**. You can also use `~~tildes~~` for ~~strikethrough~~ and `==double equals==` for ==highlighting==.

# Links
To add external links you use the `[site link](https://silverbullet.md)` syntax, which will appear as [site link](https://silverbullet.md). If you want to link to other pages in your space you use the `[[wiki link syntax]]`, e.g. [[SilverBullet]]. To change the link text you can use the `[[SilverBullet|best PKM evah]]` syntax: [[SilverBullet|best PKM evah]].

# Lists and tasks
You can create three types of lists:

Unordered lists are created by prefixing a line with `*` or `-`. For instance:

* This is an unordered list
* And this is a second item

Since this tool is called SilverBullet, we prefer you to use the `*` bullet (which will even appear in _silver_ — clever huh?).

Ordered lists are created by simply putting a number followed by a period at the beginning of a line:

1. This is the first item
2. This is the second item

SilverBullet also supports a variant of the unordered list item to define task. Tasks are defined using the `* [ ] Task name` syntax:

* [ ] This is a task
* [ ] And this is another

When you click the checkbox, it will toggle its state and replace the ` ` inside the box with `x`. SilverBullet also supports custom task statuses by putting text in between `[` and `]`. When you click on such custom task states, it will cycle through all the task states it’s seen in your space:

* [IN PROGRESS] This task is in progress
* [DONE] This task is done
* [TO DO] This task is still to be done

# Headers
Markdown supports various levels of headings, which generally are created by prefixing a line with one or more `#`. The more `#`‘s the deeper the header nesting. 

# Quotes
You can use block quotes by prefixing lines with `>`:

> “If you don’t know where you’re going, you may not get there.”
> — Yogi Berra

# Code
For the programmers among us, there are three ways to mark up code. If you want to write some code inline, you can use backticks: `this is code`. For long code snippets, you can either use a four-space indent:

    This is code
    And another line

or (preferably) the triple-back tick notation, which also allows you to (optionally) specify a coding language:

```javascript
function hello() {
   return "sup";
}
```

SilverBullet supports [[Markdown/Syntax Highlighting]] for many languages out of the box.

