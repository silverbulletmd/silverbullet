export const wikiLinkRegex = /(!?\[\[)([^\]\|]+)(?:\|([^\]]+))?(\]\])/g; // [fullMatch, firstMark, url, alias, lastMark]
export const mdLinkRegex = /!?\[(?<title>[^\]]*)\]\((?<url>.+)\)/g; // [fullMatch, alias, url]
export const tagRegex =
  /#[^\d\s!@#$%^&*(),.?":{}|<>\\][^\s!@#$%^&*(),.?":{}|<>\\]*/;
export const pWikiLinkRegex = new RegExp("^" + wikiLinkRegex.source); // Modified regex used only in parser
