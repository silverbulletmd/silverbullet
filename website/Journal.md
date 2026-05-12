SilverBullet ships with basic support for (daily) journaling. Each day you get a fresh journal page (by running the `Journal: Today` command). On this page you can capture what’s happening throughout the day, typically as a bulleted list. By linking to (topic) pages from journal entries, those entries automatically appear on the topic page via [[Linked Mention|Linked Mentions]], building a timeline of activity for every topic you care about. You can freely mix this with a more [[Guide/Knowledge Base]] approach as you see fit.

As with anything in SilverBullet, this is a feature that’s fully optional to use. You can disable it wholesale in the [[Configuration Manager]].

# Journal pages
Press `Ctrl-q j` (default keyboard shortcut), or run `Journal: Today`. You will land on today’s journal page (by default `Journal/YYYY-MM-DD`) with a bullet list ready to go. Run it again later in the day and you’ll come back to the same page. The default space template will contain a button to navigate to this page quickly.

To navigate through your existing entries, use:
* `Journal: Previous Day` (`Ctrl-q p`)
* `Journal: Next Day` (`Ctrl-q n`)
* `Journal: Picker`

The day-stepping commands only cycle through entries you’ve actually already created before.

# Linking to topics
The real power comes from linking journal entries to topic pages. Instead of plain text, reference the pages that matter:

```markdown
* Reviewed the Q2 roadmap with [[Alice]] and [[Bob]]
  * Agreed to prioritize the API redesign
  * [[Alice]] will draft the migration plan
* Started reading [[Invisible Cities]]
* Fixed a bug in the [[Login Flow]]
  * Root cause was a missing null check in the session handler
```

Each `[[link]]` connects that journal entry (and its sub-items) to the referenced page.

# Watch topic pages come alive
Now navigate to any of the referenced topic pages. In the [[Linked Mention]] section at the bottom, you will see the journal entries that mention it, including the the surrounding context and sub-items. Tomorrow’s journal entry mentioning that same page will appear there too.

Over time, each topic page accumulates a reverse-chronological log of every journal entry that references it. You don’t need to manually maintain this log — it builds itself from your daily writing.

This works for any kind of page: people, projects, concepts, books. Your journal becomes the connective tissue between all your topics.

# Customization
The easiest way to customize the Journaling feature is by configuring its various options via the [[Configuration Manager]] in the “Journal” category.

## Enable/disable
This option will enable the feature (specifically its commands) wholesale.

## Changing the template
You can tweak the default journal template as you see fit. To do so, first make a copy of [[^Library/Std/Journal/Template]] (the default one ships with SilverBullet and is read only), tweak it and set it as the template in journal configuration.

## Configure prefix
Journal entries default to `Journal/YYYY-MM-DD`. This `Journal/` prefix is configurable.

## Tag
By default journal pages are tagged `journal`. However, this is configurable as well. This tag is used by the various Journal commands for navigation.