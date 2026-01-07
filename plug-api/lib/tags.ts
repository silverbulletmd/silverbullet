/** Extract the name from hashtag text, removing # prefix and <angle brackets> if necessary */
export function extractHashtag(text: string): string {
  if (text[0] !== "#") { // you shouldn't call this function at all
    console.error("extractHashtag called on already clean string", text);
    return text;
  } else if (text[1] === "<") {
    if (text.slice(-1) !== ">") { // this is malformed: #<name but maybe we're trying to autocomplete
      return text.slice(2);
    } else { // this is correct #<name>
      return text.slice(2, -1);
    }
  } else { // this is just #name
    return text.slice(1);
  }
}
