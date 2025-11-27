export const wikiLinkRegex =
  /(?<leadingTrivia>!?\[\[)(?<stringRef>.*?)(?:\|(?<alias>.*?))?(?<trailingTrivia>\]\])/g;
export const mdLinkRegex = /!?\[(?<title>[^\]]*)\]\((?<url>.+)\)/g;
export const tagRegex =
  /#(?:(?:\d*[^\d\s!@#$%^&*(),.?":{}|<>\\][^\s!@#$%^&*(),.?":{}|<>\\]*)|(?:<[^>\n]+>))/;
export const nakedUrlRegex =
  /(^https?:\/\/([-a-zA-Z0-9@:%_\+~#=]|(?:[.](?!(\s|$)))){1,256})(([-a-zA-Z0-9(@:%_\+~#?&=\/]|(?:[.,:;)](?!(\s|$))))*)/;
export const frontmatterQuotesRegex = /["'].*["']/g;
export const frontmatterUrlRegex = /(https?:\/\/[^\s"']+)/g;
export const frontmatterWikiLinkRegex =
  /(?<leadingTrivia>!?\[\[)(?<stringRef>.*?)(?:\|(?<alias>.*?))?(?<trailingTrivia>\]\])/g;
export const pWikiLinkRegex = new RegExp("^" + wikiLinkRegex.source); // Modified regex used only in parser
