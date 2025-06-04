// Adapted and simplified from https://github.com/adaltas/node-printf

/**
 * Tokenizes a string by a regular expression with the ability to capture the delimiters
 */
const tokenize = function (
  str: string,
  re: RegExp,
  parseDelim?: (
    ...args: any[]
  ) => any,
  instance?: any,
): Array<string | TokenInfo> {
  // Split a string by a regular expression with the ability to capture the delimiters
  // parseDelim: Each group (excluding the 0 group) is passed as a parameter. If the function returns
  //    a value, it's added to the list of tokens.
  // instance: Used as the "this' instance when calling parseDelim
  const tokens: Array<string | TokenInfo> = [];
  let match: RegExpExecArray | null;
  let content: string;
  let lastIndex = 0;

  while ((match = re.exec(str))) {
    content = str.slice(lastIndex, re.lastIndex - match[0].length);
    if (content.length) {
      tokens.push(content);
    }
    if (parseDelim) {
      const parsed = parseDelim.apply(
        instance,
        [...match.slice(1), tokens.length],
      );
      if (typeof parsed !== "undefined") {
        if (parsed.specifier === "%") {
          tokens.push("%");
        } else {
          tokens.push(parsed);
        }
      }
    }
    lastIndex = re.lastIndex;
  }
  content = str.slice(lastIndex);
  if (content.length) {
    tokens.push(content);
  }
  return tokens;
};

interface TokenInfo {
  mapping?: string;
  intmapping?: string;
  flags: string;
  _minWidth?: string;
  period?: string;
  _precision?: string;
  specifier: string;
  arg?: string;
  compiled?: boolean;
  sign?: string;
  zeroPad?: boolean;
  rightJustify?: boolean;
  alternative?: boolean;
  minWidth?: number;
  maxWidth?: number;
  toUpper?: boolean;
  isUnsigned?: boolean;
  isInt?: boolean;
  isDouble?: boolean;
  isObject?: boolean;
  precision?: number;
  base?: number;
  doubleNotation?: string;
  setArg?: (token: TokenInfo) => void;
  setMaxWidth?: (token: TokenInfo) => void;
  extend?: string[];
  [key: string]: any; // Allow dynamic property access
}

interface SpecifierInfo {
  base?: number;
  isInt?: boolean;
  extend?: string[];
  toUpper?: boolean;
  isUnsigned?: boolean;
  setArg?: (token: TokenInfo) => void;
  setMaxWidth?: (token: TokenInfo) => void;
  isDouble?: boolean;
  doubleNotation?: string;
  isObject?: boolean;
  [key: string]: any; // Allow dynamic property access
}

class Formatter {
  private _mapped: boolean;
  private _format: string;
  private _tokens: Array<string | TokenInfo>;
  private _zeros10: string = "0000000000";
  private _spaces10: string = "          ";
  private _re: RegExp =
    /\%(?:\(([\w_.]+)\)|([1-9]\d*)\$)?([0 +\-\#]*)(\*|\d+)?(?:(\.)(\*|\d+)?)?[hlL]?([\%bscdeEfFgGioOuxX])/g;
  private _specifiers: Record<string, SpecifierInfo> = {
    b: {
      base: 2,
      isInt: true,
    },
    o: {
      base: 8,
      isInt: true,
    },
    x: {
      base: 16,
      isInt: true,
    },
    X: {
      extend: ["x"],
      toUpper: true,
    },
    d: {
      base: 10,
      isInt: true,
    },
    i: {
      extend: ["d"],
    },
    u: {
      extend: ["d"],
      isUnsigned: true,
    },
    c: {
      setArg: function (token: TokenInfo): void {
        if (!isNaN(Number(token.arg))) {
          const num = parseInt(token.arg as string);
          if (num < 0 || num > 127) {
            throw new Error("invalid character code passed to %c in printf");
          }
          token.arg = isNaN(num) ? "" + num : String.fromCharCode(num);
        }
      },
    },
    s: {
      setMaxWidth: function (token: TokenInfo): void {
        token.maxWidth = (token.period === ".") ? token.precision ?? -1 : -1;
      },
    },
    e: {
      isDouble: true,
      doubleNotation: "e",
    },
    E: {
      extend: ["e"],
      toUpper: true,
    },
    f: {
      isDouble: true,
      doubleNotation: "f",
    },
    F: {
      extend: ["f"],
    },
    g: {
      isDouble: true,
      doubleNotation: "g",
    },
    G: {
      extend: ["g"],
      toUpper: true,
    },
    O: {
      isObject: true,
    },
  };

  constructor(format: string) {
    this._mapped = false;
    this._format = format;
    this._tokens = tokenize(format, this._re, this._parseDelim, this);
  }

  // The old regexp `/\%(?:\(([\w_.]+)\)|([1-9]\d*)\$)?([0 +\-\#]*)(\*|\d+)?(\.)?(\*|\d+)?[hlL]?([\%bscdeEfFgGioOuxX])/` has a cubic worst-case time complexity behavior due to overlapping capture groups `([0 +\-\#]*)(\*|\d+)?(\.)?(\*|\d+)?`. And a pump string of 0 can be consumed by `([0 +\-\#]*), (\*|\d+)?, or (\*|\d+)?`.
  // The solution replace the sub-regexp (\*|\d+)?(\.)?(\*|\d+)? with the sub-regexp `(\*|\d+)?(?:(\.)(\*|\d+)?)?`, see the figure in [#32](https://github.com/adaltas/node-printf/pull/32)
  // There are also performance improvement, see in [#31](https://github.com/adaltas/node-printf/issues/31#issuecomment-776731490)

  private _parseDelim(
    mapping?: string,
    intmapping?: string,
    flags?: string,
    minWidth?: string,
    period?: string,
    precision?: string,
    specifier?: string,
  ): TokenInfo {
    if (mapping) {
      this._mapped = true;
    }
    return {
      mapping,
      intmapping,
      flags: flags || "",
      _minWidth: minWidth,
      period,
      _precision: precision,
      specifier: specifier || "",
    };
  }

  format(...args: any[]): string {
    if (this._mapped && typeof args[0] !== "object") {
      throw new Error("format requires a mapping");
    }

    let str = "";
    let position = 0;
    for (let i = 0; i < this._tokens.length; i++) {
      const token = this._tokens[i];

      if (typeof token === "string") {
        str += token;
      } else {
        if (this._mapped) {
          // Identify value of property defined in `token.mapping`
          const tokens = token.mapping!.split(".");
          let value = args[0];
          for (let j = 0, c = tokens.length; j < c; j++) {
            value = value[tokens[j]];
            if (typeof value === "undefined") {
              break;
            }
          }
          if (typeof value === "undefined") {
            throw new Error("missing key '" + token.mapping + "'");
          }
          token.arg = String(value);
        } else {
          if (token.intmapping) {
            position = parseInt(token.intmapping) - 1;
          }
          if (position >= args.length) {
            throw new Error(
              "got " + args.length +
                " printf arguments, insufficient for '" + this._format + "'",
            );
          }
          token.arg = String(args[position++]);
        }

        if (!token.compiled) {
          token.compiled = true;
          token.sign = "";
          token.zeroPad = false;
          token.rightJustify = false;
          token.alternative = false;

          const flags: Record<string, boolean> = {};
          for (let fi = token.flags.length; fi--;) {
            const flag = token.flags.charAt(fi);
            flags[flag] = true;
            switch (flag) {
              case " ":
                token.sign = " ";
                break;
              case "+":
                token.sign = "+";
                break;
              case "0":
                token.zeroPad = (flags["-"]) ? false : true;
                break;
              case "-":
                token.rightJustify = true;
                token.zeroPad = false;
                break;
              case "#":
                token.alternative = true;
                break;
              default:
                throw Error(
                  "bad formatting flag '" + token.flags.charAt(fi) + "'",
                );
            }
          }

          token.minWidth = (token._minWidth) ? parseInt(token._minWidth) : 0;
          token.maxWidth = -1;
          token.toUpper = false;
          token.isUnsigned = false;
          token.isInt = false;
          token.isDouble = false;
          token.isObject = false;
          token.precision = 1;
          if (token.period === ".") {
            if (token._precision) {
              token.precision = parseInt(token._precision);
            } else {
              token.precision = 0;
            }
          }

          const mixins = this._specifiers[token.specifier];
          if (typeof mixins === "undefined") {
            throw new Error("unexpected specifier '" + token.specifier + "'");
          }
          if (mixins.extend) {
            const s = this._specifiers[mixins.extend[0]];
            for (const k in s) {
              mixins[k] = s[k];
            }
            delete mixins.extend;
          }
          for (const l in mixins) {
            token[l] = mixins[l];
          }
        }

        if (typeof token.setArg === "function") {
          token.setArg(token);
        }

        if (typeof token.setMaxWidth === "function") {
          token.setMaxWidth(token);
        }

        if (token._minWidth === "*") {
          if (this._mapped) {
            throw new Error("* width not supported in mapped formats");
          }
          token.minWidth = parseInt(String(args[position++]));
          if (isNaN(token.minWidth)) {
            throw new Error(
              "the argument for * width at position " + position +
                " is not a number in " + this._format,
            );
          }
          // negative width means rightJustify
          if (token.minWidth < 0) {
            token.rightJustify = true;
            token.minWidth = -token.minWidth;
          }
        }

        if (token._precision === "*" && token.period === ".") {
          if (this._mapped) {
            throw new Error("* precision not supported in mapped formats");
          }
          token.precision = parseInt(String(args[position++]));
          if (isNaN(token.precision)) {
            throw Error(
              "the argument for * precision at position " + position +
                " is not a number in " + this._format,
            );
          }
          // negative precision means unspecified
          if (token.precision < 0) {
            token.precision = 1;
            token.period = "";
          }
        }
        if (token.isInt) {
          // a specified precision means no zero padding
          if (token.period === ".") {
            token.zeroPad = false;
          }
          this.formatInt(token);
        } else if (token.isDouble) {
          if (token.period !== ".") {
            token.precision = 6;
          }
          this.formatDouble(token);
        } else if (token.isObject) {
          this.formatObject(token);
        }
        this.fitField(token);
        str += "" + token.arg;
      }
    }

    return str;
  }

  formatInt(token: TokenInfo): void {
    let i = parseInt(token.arg as string);
    if (!isFinite(i)) { // isNaN(f) || f == Number.POSITIVE_INFINITY || f == Number.NEGATIVE_INFINITY)
      // allow this only if arg is number
      if (typeof token.arg !== "number" && typeof token.arg !== "string") {
        throw new Error(
          "format argument '" + token.arg +
            "' not an integer; parseInt returned " + i,
        );
      }
      //return '' + i;
      i = 0;
    }

    // if not base 10, make negatives be positive
    // otherwise, (-10).toString(16) is '-a' instead of 'fffffff6'
    if (i < 0 && (token.isUnsigned || token.base !== 10)) {
      i = 0xffffffff + i + 1;
    }

    if (i < 0) {
      token.arg = (-i).toString(token.base);
      this.zeroPad(token);
      token.arg = "-" + token.arg;
    } else {
      token.arg = i.toString(token.base);
      // need to make sure that argument 0 with precision==0 is formatted as ''
      if (!i && !token.precision) {
        token.arg = "";
      } else {
        this.zeroPad(token);
      }
      if (token.sign) {
        token.arg = token.sign + token.arg;
      }
    }
    if (token.base === 16) {
      if (token.alternative) {
        token.arg = "0x" + token.arg;
      }
      token.arg = token.toUpper
        ? token.arg.toUpperCase()
        : token.arg.toLowerCase();
    }
    if (token.base === 8) {
      if (token.alternative && token.arg.charAt(0) !== "0") {
        token.arg = "0" + token.arg;
      }
    }
  }

  formatDouble(token: TokenInfo): void {
    let f = parseFloat(token.arg as string);
    if (!isFinite(f)) { // isNaN(f) || f == Number.POSITIVE_INFINITY || f == Number.NEGATIVE_INFINITY)
      // allow this only if arg is number
      if (typeof token.arg !== "number" && typeof token.arg !== "string") {
        throw new Error(
          "format argument '" + token.arg +
            "' not a float; parseFloat returned " + f,
        );
      }
      // C99 says that for 'f':
      //   infinity -> '[-]inf' or '[-]infinity' ('[-]INF' or '[-]INFINITY' for 'F')
      //   NaN -> a string  starting with 'nan' ('NAN' for 'F')
      // this is not commonly implemented though.
      //return '' + f;
      f = 0;
    }

    switch (token.doubleNotation) {
      case "e": {
        token.arg = f.toExponential(token.precision ?? 1);
        break;
      }
      case "f": {
        token.arg = f.toFixed(token.precision ?? 1);
        break;
      }
      case "g": {
        // C says use 'e' notation if exponent is < -4 or is >= prec
        // ECMAScript for toPrecision says use exponential notation if exponent is >= prec,
        // though step 17 of toPrecision indicates a test for < -6 to force exponential.
        if (Math.abs(f) < 0.0001) {
          //print('forcing exponential notation for f=' + f);
          token.arg = f.toExponential(
            (token.precision ?? 1) > 0
              ? (token.precision ?? 1) - 1
              : (token.precision ?? 1),
          );
        } else {
          token.arg = f.toPrecision(token.precision ?? 1);
        }

        // In C, unlike 'f', 'gG' removes trailing 0s from fractional part, unless alternative format flag ('#').
        // But ECMAScript formats toPrecision as 0.00100000. So remove trailing 0s.
        if (!token.alternative) {
          //print('replacing trailing 0 in \'' + s + '\'');
          token.arg = token.arg.replace(/(\..*[^0])0*e/, "$1e");
          // if fractional part is entirely 0, remove it and decimal point
          token.arg = token.arg.replace(/\.0*e/, "e").replace(/\.0$/, "");
        }
        break;
      }
      default:
        throw new Error(
          "unexpected double notation '" + token.doubleNotation + "'",
        );
    }

    // C says that exponent must have at least two digits.
    // But ECMAScript does not; toExponential results in things like '1.000000e-8' and '1.000000e+8'.
    // Note that s.replace(/e([\+\-])(\d)/, 'e$10$2') won't work because of the '$10' instead of '$1'.
    // And replace(re, func) isn't supported on IE50 or Safari1.
    token.arg = token.arg.replace(/e\+(\d)$/, "e+0$1").replace(
      /e\-(\d)$/,
      "e-0$1",
    );

    // if alt, ensure a decimal point
    if (token.alternative) {
      token.arg = token.arg.replace(/^(\d+)$/, "$1.");
      token.arg = token.arg.replace(/^(\d+)e/, "$1.e");
    }

    if (f >= 0 && token.sign) {
      token.arg = token.sign + token.arg;
    }

    token.arg = token.toUpper
      ? token.arg.toUpperCase()
      : token.arg.toLowerCase();
  }

  formatObject(token: TokenInfo): void {
    // Simple object formatting without util.inspect
    if (token.arg === null) {
      token.arg = "null";
      return;
    }

    if (token.arg === undefined) {
      token.arg = "undefined";
      return;
    }

    // Use JSON.stringify with indentation for objects
    try {
      // Limit depth based on precision if specified
      const maxDepth = token.period === "." && token.precision !== undefined
        ? token.precision
        : 2;

      // Create a simplified version of the object with limited depth
      const simplifiedObj = this.limitObjectDepth(token.arg, maxDepth);

      // Format with indentation if alternative flag is set
      token.arg = JSON.stringify(
        simplifiedObj,
        null,
        token.alternative ? 2 : 0,
      );
    } catch {
      // Fallback for circular references or other JSON.stringify errors
      token.arg = String(token.arg);
    }
  }

  // Helper method to limit object depth for formatObject
  private limitObjectDepth(obj: any, maxDepth: number, currentDepth = 0): any {
    if (currentDepth >= maxDepth) {
      if (Array.isArray(obj)) {
        return "[Array]";
      } else if (typeof obj === "object" && obj !== null) {
        return "[Object]";
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) =>
        this.limitObjectDepth(item, maxDepth, currentDepth + 1)
      );
    } else if (typeof obj === "object" && obj !== null) {
      const result: Record<string, any> = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = this.limitObjectDepth(
            obj[key],
            maxDepth,
            currentDepth + 1,
          );
        }
      }
      return result;
    }

    return obj;
  }

  zeroPad(token: TokenInfo, length?: number): void {
    length = (arguments.length === 2) ? length : token.precision;
    let negative = false;
    if (typeof token.arg !== "string") {
      token.arg = "" + token.arg;
    }
    if (token.arg.substr(0, 1) === "-") {
      negative = true;
      token.arg = token.arg.substr(1);
    }

    const tenless = (length || 0) - 10;
    while (token.arg.length < tenless) {
      token.arg = (token.rightJustify)
        ? token.arg + this._zeros10
        : this._zeros10 + token.arg;
    }
    const pad = (length || 0) - token.arg.length;
    token.arg = (token.rightJustify)
      ? token.arg + this._zeros10.substring(0, pad)
      : this._zeros10.substring(0, pad) + token.arg;
    if (negative) token.arg = "-" + token.arg;
  }

  fitField(token: TokenInfo): void {
    if (
      token.maxWidth !== undefined && token.maxWidth >= 0 &&
      token.arg!.length > token.maxWidth
    ) {
      token.arg = token.arg!.substring(0, token.maxWidth);
    }
    if (token.zeroPad) {
      this.zeroPad(token, token.minWidth);
      return;
    }
    this.spacePad(token);
  }

  spacePad(token: TokenInfo, length?: number): void {
    length = (arguments.length === 2) ? length : token.minWidth;
    if (typeof token.arg !== "string") {
      token.arg = "" + token.arg;
    }
    const tenless = (length || 0) - 10;
    while (token.arg.length < tenless) {
      token.arg = (token.rightJustify)
        ? token.arg + this._spaces10
        : this._spaces10 + token.arg;
    }
    const pad = (length || 0) - token.arg.length;
    token.arg = (token.rightJustify)
      ? token.arg + this._spaces10.substring(0, pad)
      : this._spaces10.substring(0, pad) + token.arg;
  }
}

/**
 * Printf-style string formatting function
 * @param format The format string
 * @param args Values to be formatted
 * @returns Formatted string
 */
export default function (format: string, ...args: any[]): string {
  const formatter = new Formatter(format);
  return formatter.format(...args);
}
