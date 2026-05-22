#getting-started #guide

Welcome! This guide helps you get started with SilverBullet assuming you have it successfully [[Install|installed as a server]] or [desktop app](https://silverbullet.plus). 

# First launch
Once you launch SilverBullet on a fresh [[Space]], you will be greeted by its automatically generated [[Index Page]] that contains a few sections:

1. Recent quick notes
2. Recent journal entries
3. Recent incomplete tasks
4. Recently modified pages

Different people will end up having different workflows and use cases for SilverBullet (covered more deeply in the various more in-depth guides later). However, to not have you start with a (scary) blank page, these four sections should give you a starting point.

# Quick notes
The idea of the quick note is to serve as a modern replacement for the old-fashioned “I just need to jot something down, gimme a piece of paper, _quick!_”

When such an occasion arrises, you have a few options:
1. On your index page click the “Create quick note” button
2. Hit the `Ctrl-q` keyboard shortcut followed by another `q` (or `Ctrl-q`), so `Ctrl-q Ctrl-q` — quick, _quick_!

Either of these will navigate to a new page with the `Inbox/` prefix followed by the current date and time. 

Start typing your [[Markdown]] and be confident your quick thoughts are safely persisted to your space. There’s no save button to push. Every second or two your changes are persisted safely.

This workflow helps you getting quick notes down so none of your brilliance (or anybody’s phone number) gets lost. However, it’s not a great strategy for finding this information again later. Yet, the first priority was to jot it down. That now happened. Relax.

The next step is to either rename the note (by simply clicking on the page title at the top), changing it to something more descriptive, and hitting `Enter`. This will rename the page instantly. Or to simply cut and paste the content elsewhere and then clean it up with the `Page: Delete` command. Commands can be invoked by name by clicking the little “command prompt” button at the top right, or hitting `Cmd-/` on Mac or `Ctrl-/` anywhere else.

Now, when you move back to your index page by clicking the “home” button, you will notice (unless you immediately renamed your quick note) that your note now appears in a list in the “Recent quick notes.” section. How did that happen? This is where the SilverBullet magic starts. This is [[Space Lua/Integrated Query]] at work, but there’s no need to go there _yet_, just enjoy this functionality as it is for now (or peek a bit under the hood by `Alt`-clicking on this widget to see what’s the code underlying it).

A common workflow is to keep making quick notes as you need. Then, whenever you have time, go through the list and rename them, move the content or delete them so that your quick note list is empty again.

But this is your space, so you can use (or not use) them however you like.

# Journal entries
Dear diary, a [[Journal]] entry is in effect not that much different than a quick note, except that its page names are prefixed with `Journal/` and only contain the date, but not time. And that every time you click the “Today’s entry” button (or run the `Journal: Today` command, or hit `Ctrl-q j`) you end up on the page for that day and are greeted with a (silver) bullet:

    *

A common workflow is keep this page open throughout the day and use it as your journal [[Outlines|Outline]]. You can use it to create tasks for yourself (see [[#Tasks]] later), write quick notes to yourself (if you don’t use quick notes), and make notes about meetings your in.

Now here is (one) of SilverBullet killer features: if you start to link to topic pages in your journal, you now are starting to build your knowledge graph. 

What does _any of that mean_? Let’s make this more concrete, let’s add an item to our journal:

    * Met with [[Allan]] today to talk about [[Project Phoenix]]:
      * Happy with project progress
      * [ ] Agreed I need to come up with a better project name

The `[[page]]` syntax is [[Link]] syntax. It allows you to create a web of links across your space, like a personal [wiki](https://en.wikipedia.org/wiki/Wiki). However — and here’s the kicker — these links are bi-directional. This means that _on the page you link to you can see what pages point to it_.

This means that if I now click on the `Allan` link, I navigate to this page (or create it, if it didn’t exist yet) and there in a [[Linked Mention]] section I will see that on this and that journal page, I mentioned Alan + all the sub-items mentioned in the journal. Cool right?

This way, as you chronicle your journey day by day, mentioning people, projects and other “topics”, you implicitly contribute content to these topics. On the topic pages you link to you will see where they are mentioned and the context, and you can add additional information as you see fit in the page itself.

## Navigating journals
On your index page you will see a list of all the days you’ve created a journal page for which is useful for navigation. If you’re on a journal page you can also use the `Journal: Previous Day` and `Journal: Next Day` command (these have keyboard shortcuts too) to walk through the various entries, or use `Journal: Picker` to get a list of all of them.

# Tasks
As you journal or create quick notes or topic pages, you may want to make note of things to do. For this, markdown offers [[Task]] syntax:

    * [ ] My task

It’s a tad ugly and annoying to type, but this is where another convenient SilverBullet feature will jump to the rescue: slash commands. Type “My task”, then a space, then `/task` and hit enter, it will now turn your current line (or bulleted list item) into a task, just like that.

You will notice that visually it will turn `[ ]` into a checkbox. You can go ahead and click that, it does what you expect. 

Now as you collect incomplete tasks across your space, the “Recent incomplete tasks” will collect them all in one place until they’re done.

Now, reality check: it’s likely you will collect a lot of these and this list will become unwieldly so likely you’ll want to replace this list with something more specific later. For this see the [[Guide/Task Management]] guide.

# Recently modified pages
This section does what it says on the tin: it shows you the last 10 modified pages in your space. Useful to get back to where you were last making changes. That’s all there’s to it, really.

# What's next?
Now that you know the basics, explore these guides for real-world workflows:

* [[Journal]] — set up a daily journal
* [[Guide/Knowledge Base]] — build a personal knowledge base
* [[Guide/Task Management]] — track projects and tasks
* [[Guide/People Notes]] — keep track of people and conversations
* [[Manual]] — the full user manual
* [[Space Lua]] — learn more about the scripting language that gives SilverBullet a lot of its power
* [[Object]] — understand how SilverBullet indexes your content
