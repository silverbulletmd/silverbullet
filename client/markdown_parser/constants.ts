export const wikiLinkRegex =
  /(?<leadingTrivia>!?\[\[)(?<stringRef>.*?)(?:\|(?<alias>.*?))?(?<trailingTrivia>\]\])/g;
export const mdLinkRegex = /!?\[(?<title>[^\]]*)\]\((?<url>.+)\)/g;
export const tagRegex =
  /#(?:(?:\d*[^\d\s!@#$%^&*(),.?":{}|<>\\][^\s!@#$%^&*(),.?":{}|<>\\]*)|(?:<[^>\n]+>))/;
export const nakedUrlRegex =
  /(^https?:\/\/([-a-zA-Z0-9@:%_\+~#=]|(?:[.](?!(\s|$)))){1,256})(([-a-zA-Z0-9(@:%_\+~#?&=\/]|(?:[.,:;)](?!(\s|$))))*)/;
export const frontmatterQuotesRegex = /["'].*["']/g;
export const frontmatterUrlRegex = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"']+)/g;
export const frontmatterWikiLinkRegex =
  /(?<leadingTrivia>!?\[\[)(?<stringRef>.*?)(?:\|(?<alias>.*?))?(?<trailingTrivia>\]\])/g;
export const frontmatterMailtoRegex = /(mailto:[^@\s]+@[^@\s"']+)/ig;
export const pWikiLinkRegex = new RegExp("^" + wikiLinkRegex.source); // Modified regex used only in parser
