Every document or page in SilverBullet is identified by a path. The path represents the location where the corresponding page or document is stored inside your space folder. Paths are always absolute and always have to end in an [[#Extensions|extension]].

# Extensions
A valid extension is a `.` followed by one or more digits or letters, followed by the end of the string.

# Relation to names
The name of a page or document is very closely related to it’s path, specifically you get from the name to the path by adding `.md` to names not ending in a valid extension.
Inversely you can get the name from a path by removing any `.md` extension, which may exist (This is also the reason, why names cannot end in `.md`).
This entails that paths have to conform to the same [[Names#Rules|rules]] names have to.

# Valid Examples
- “foo.md”
- “foo.png”
- “bar.tar.gz”
- “bar.foo bar.baz”
- “this/is/a/path.md”

# Invalid Examples
- “foo”
- “/foo”
- “.foo”
- “foo@bar”
- “foo.md.md”