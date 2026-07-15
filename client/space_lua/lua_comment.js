import { ExternalTokenizer } from "@lezer/lr";
import { Comment } from "./parse-lua.terms.js";

const DASH = 45;
const EQUALS = 61;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;

/** Tokenizes Lua line and long comments, including arbitrary `=` depth. */
export const luaComment = new ExternalTokenizer((input) => {
  if (input.next !== DASH || input.peek(1) !== DASH) return;

  input.advance(2);

  if (input.next === OPEN_BRACKET) {
    input.advance();
    let equalsCount = 0;
    while (input.next === EQUALS) {
      equalsCount++;
      input.advance();
    }

    if (input.next === OPEN_BRACKET) {
      input.advance();
      while (input.next !== -1) {
        if (input.next === CLOSE_BRACKET) {
          let matches = true;
          for (let i = 0; i < equalsCount; i++) {
            if (input.peek(i + 1) !== EQUALS) {
              matches = false;
              break;
            }
          }
          if (matches && input.peek(equalsCount + 1) === CLOSE_BRACKET) {
            input.advance(equalsCount + 2);
            input.acceptToken(Comment);
            return;
          }
        }
        input.advance();
      }

      // An unfinished long comment is a syntax error, just like an unfinished
      // long string, so deliberately do not emit a token.
      return;
    }
  }

  while (
    input.next !== -1 &&
    input.next !== LINE_FEED &&
    input.next !== CARRIAGE_RETURN
  ) {
    input.advance();
  }
  input.acceptToken(Comment);
});
