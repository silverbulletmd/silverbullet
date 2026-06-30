---
references:
- plug-api/lib/ref.ts
- plugs/index/refactor.ts
---
In [[SilverBullet]] every [[Page|page]] or [[Document|document]] has a name. Names are (currently) unique, meaning no two pages or documents can share the same name.

# Rules
Names _must_ also follow certain rules:
- Names cannot be empty
- Names cannot start with a `.`, `^` nor `/`
* Names cannot contain the characters `|`, `@` or `#`
* Names cannot contain the sequences `[[` or `]]`
* Names cannot contain one or two `.` enclosed by a combination of the start/end of the name or `/`
* Names cannot contain `//`
* Names cannot end in `.md` (See [[Paths#Relation to names]] section)
- (Names are case-sensitive and contrary to most filesystem, `/` is allowed)

## Valid Examples
- “foo”
- “this/is/a/page/name”
- “this/.../is/also/a/page”
- “this/is/a/document.png”

## Invalid Examples
- “foo@bar”
- “.foo”
- “foo//bar”
- “foo/../bar”

# Special characters
Certain HTTP reverse proxies may block “suspicious” characters (such as `?`, `#` and `;`) by default, including Traefik, [see this thread](https://community.silverbullet.md/t/traefik-proxied-setups-block-page-names-with-fix/3724/2) on how to work around this.

# Naming conventions
Beyond the hard rules above, there is a widely-used stylistic convention for everyday content pages:

* **Use Title Case with spaces**: name a page as you’d write it in prose: `Customer Persona`, `Release Process` — not `customer-persona`, `release_process`, or `CustomerPersona`. The page name doubles as its title and as inline link text, so a readable name reads well in context: `see [[Release Process]]`.
* **Keep the namespace flat** by default: place most pages at the top level and reach for folders only once a clear grouping earns it. See [[Best Practices#Flat name space]] for the rationale.

These are conventions, not enforced rules — your space is yours to organise however suits you.