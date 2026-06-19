---
description: Template for an Architecture Decision Record (ADR).
command: "ADR: New"
suggestedName: "ADR/000 Untitled Decision"
confirmName: true
tags: meta/template/page
frontmatter: |
  tags: adr
  status: proposed
  date: "${date.today()}"
  deciders: "[[Zef Hemel]]"
  owner: "[[Zef Hemel]]"
  lastReviewed: "${date.today()}"
  supersededBy:
  dependsOn:
  related:
---
# Context
The problem, the forces at play, and the constraints that made a decision necessary. What changed, and why now? |^|

# Decision
What we decided, stated plainly in one or two sentences.

# Consequences
## Positive
* What we gain.

## Negative / trade-offs
* What we accept in return.

# Alternatives considered
The other options weighed, and why each was not chosen.

# References
* Real links out: GitHub [PRs/commits/issues](https://github.com/silverbulletmd/silverbullet) and external sources. (Links to other ADRs go in the `dependsOn` / `related` frontmatter.)
