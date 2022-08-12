import passport from 'passport';
import {Strategy as GitHubStrategy} from 'passport-github';
import {Strategy as BearerStrategy} from 'passport-http-bearer';

// todo: get them from the config or env variables.
let GITHUB_CLIENT_ID = process.env.SB_GH_CLIENT_ID;
let GITHUB_CLIENT_SECRET = process.env.SB_GH_CLIENT_SECRET;

export const GITHUB = 'github';
export const PASSWORD = 'password';

interface Strategy {
  [key: string]: string;
}

export function setupPassportStrategies(strategies: Strategy) {
  if (strategies[GITHUB]) {
    if (typeof GITHUB_CLIENT_ID === "undefined" || typeof GITHUB_CLIENT_SECRET === "undefined") {
      throw new Error("Can't configure github auth strategy without client_id and client_secret. Please refer to the docs to set them up.");
    }
    passport.use(
      new GitHubStrategy({
        clientID: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
        callbackURL: "http://127.0.0.1:3000/auth/github/callback"
      },
      function(accessToken: string, refreshToken: string, profile: any, cb:(err?: Error, user?: string) => void) {
        if (profile.login !== strategies[GITHUB]) {
          return cb(new Error("User is not authorized to use this app"));
        }
        return cb(undefined, profile.login);
      }));
  }
  // maybe in the future might make sense having more than one auth strategy (i.e.: multiuser support), but for now we should restrict to one at most
  else if (strategies[PASSWORD]) {
    passport.use(new BearerStrategy((token: string, cb:(err?: Error, user?: string)=>void) => {
      if (token !== strategies[PASSWORD]) {
        return cb(new Error("Invalid password"));
      }
      return cb(undefined, "user");
    }));
  }
}

export function getAuthenticateMiddleware(strategy: string) {
  return (...args: any[]) => {
    return passport.authenticate(strategy, ...args);
  }
}