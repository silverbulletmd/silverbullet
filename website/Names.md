In [[SilverBullet]] every [[Pages|page]] or [[Documents|document]] has a name. Names are (currently) unique, meaning no two pages or documents can share the same name.

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
