/**
 * Basic XML parser for Deno
 * https://github.com/nekobato/deno-xml-parser
 * By Hayato Koriyama, MIT licensed
 * Based on https://github.com/segmentio/xml-parser (MIT licensed)
 * "Simple non-compiant XML parser because we just need to parse some basic responses"
 */

interface Document {
  declaration: {
    attributes: Record<string, string>;
  };
  root: {
    name: string;
    attributes: Record<string, string>;
    children: Xml[];
  } | undefined;
}

interface Xml {
  name: string;
  attributes: Record<string, string>;
  content?: string;
  children: Xml[];
}

/**
 * Parse the given string of `xml`.
 *
 * @param {String} xml
 * @return {Object}
 * @api public
 */
export function parse(xml: string): Document {
  xml = xml.trim();

  // strip comments
  xml = xml.replace(/<!--[\s\S]*?-->/g, "");

  return document();

  /**
   * XML document.
   */
  function document(): Document {
    return {
      declaration: declaration(),
      root: tag(),
    };
  }

  /**
   * Declaration.
   */
  function declaration() {
    const m = match(/^<\?xml\s*/);
    if (!m) return;

    // tag.
    // deno-lint-ignore no-explicit-any
    const node: any = {
      attributes: {},
    };

    // attributes
    while (!(eos() || is("?>"))) {
      const attr = attribute();
      if (!attr) return node;
      node.attributes[attr.name] = attr.value;
    }

    match(/\?>\s*/);

    return node;
  }

  /**
   * Tag.
   */
  function tag() {
    const m = match(/^<([\w-:.]+)\s*/);
    if (!m) return;

    // name
    const node: Xml = {
      name: m[1],
      attributes: {},
      children: [],
    };

    // attributes
    while (!(eos() || is(">") || is("?>") || is("/>"))) {
      const attr = attribute();
      if (!attr) return node;
      node.attributes[attr.name] = attr.value;
    }

    // self closing tag
    if (match(/^\s*\/>\s*/)) {
      return node;
    }

    match(/\??>\s*/);

    // content
    node.content = content();

    // children
    let child;
    while ((child = tag())) {
      node.children.push(child);
    }

    // closing
    match(/^<\/[\w-:.]+>\s*/);

    return node;
  }

  /**
   * Text content.
   */
  function content() {
    const m = match(/^([^<]*)/);
    if (m) return m[1];
    return "";
  }

  /**
   * Attribute.
   */
  function attribute() {
    const m = match(/([\w:-]+)\s*=\s*("[^"]*"|'[^']*'|\w+)\s*/);
    if (!m) return;
    return { name: m[1], value: strip(m[2]) };
  }

  /**
   * Strip quotes from `val`.
   */
  function strip(val: string) {
    return val.replace(/^['"]|['"]$/g, "");
  }

  /**
   * Match `re` and advance the string.
   */
  function match(re: RegExp) {
    const m = xml.match(re);
    if (!m) return;
    xml = xml.slice(m[0].length);
    return m;
  }

  /**
   * End-of-source.
   */
  function eos() {
    return 0 == xml.length;
  }

  /**
   * Check for `prefix`.
   */
  function is(prefix: string) {
    return 0 == xml.indexOf(prefix);
  }
}
