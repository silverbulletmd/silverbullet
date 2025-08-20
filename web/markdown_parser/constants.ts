export const wikiLinkRegex =
  /(?<leadingTrivia>!?\[\[)(?<stringRef>.*?)(?:\|(?<alias>.*?))?(?<trailingTrivia>\]\])/g;
export const mdLinkRegex = /!?\[(?<title>[^\]]*)\]\((?<url>.+)\)/g;
export const tagRegex =
  /#(?:(?:\d*[^\d\s!@#$%^&*(),.?":{}|<>\\][^\s!@#$%^&*(),.?":{}|<>\\]*)|(?:<[^>\n]+>))/;
export const pWikiLinkRegex = new RegExp("^" + wikiLinkRegex.source); // Modified regex used only in parser
