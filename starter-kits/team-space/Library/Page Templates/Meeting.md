---
tags: meta/template/page
description: A new meeting page with agenda, notes, decisions and action items
command: "Meeting: New"
suggestedName: "Meetings/${os.date('%Y-%m-%d')} "
confirmName: true
frontmatter: |
  tags: meeting
  date: "${date.today()}"
  attendees: []
---
# Agenda
* |^|

# Notes

# Decisions

# Action items
* [ ] First action item [owner: ]
