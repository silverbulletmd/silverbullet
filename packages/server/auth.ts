import passport from "passport";
import {Strategy as GitHubStrategy} from "passport-github2";
import {Strategy as BearerStrategy} from "passport-http-bearer";
import {RequestHandler} from "express";


let GITHUB_CLIENT_ID = process.env.SB_GH_CLIENT_ID;
let GITHUB_CLIENT_SECRET = process.env.SB_GH_CLIENT_SECRET;
let SB_HOST = process.env.SB_HOST || "http://127.0.0.1:3000";
export const GITHUB = "github";
export const PASSWORD = "bearer";

export interface StrategyConfig {
  [key: string]: string;
}

export function setupPassportStrategies(strategies: StrategyConfig) {
  if (strategies[GITHUB]) {
    if (typeof GITHUB_CLIENT_ID === "undefined" || typeof GITHUB_CLIENT_SECRET === "undefined") {
      throw new Error("Can't configure github auth strategy without client_id and client_secret. Please refer to the docs to set them up.");
    }
    passport.use(
      new GitHubStrategy({
        clientID: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
        callbackURL: `${SB_HOST}/auth/oauth/callback`
      },
      function(accessToken: string, _refreshToken: string, profile: any, cb:(err?: Error, user?: string) => void) {
        if (profile.username !== strategies[GITHUB]) {
          console.log('access with wrong token');
          return cb();
        }
        console.log('access ok');
        return cb(undefined, profile.username);
      }));
  }
  // maybe in the future might make sense having more than one auth strategy (i.e.: multiuser support), but for now we should restrict to one at most
  else if (strategies[PASSWORD]) {
    passport.use(new BearerStrategy((token: string, cb:(err?: Error, user?: string)=>void) => {
      if (!token) {
        return cb(new Error("Unauthorized"));
      }
      if (token !== strategies[PASSWORD]) {
        return cb(new Error('Unauthorized'));
      }
      return cb(undefined, "defaultUser");
    }));
  }
}

export function getAuthenticateMiddleware(strategy: string) {
  if (strategy === GITHUB) {
    return (... args: any[]) => {
      return passport.authenticate(strategy, ...args);
    }
  }
  if (strategy === PASSWORD) {
    return (... args: any[]) => {
      return passport.authenticate(strategy, {session: true}, ...args);
    }
  }
  return (...args: any[]) => {
    return passport.authenticate(strategy, ...args);
  }
}

export function getEnsureAuthenticated(strategies: StrategyConfig): RequestHandler {
  if (strategies[GITHUB]) {
    return (req: any, res: any, next: any) => {
      if (req.user === strategies[GITHUB]) {
        return next(); 
      }
      res.redirect('/auth/login');
    }
  }
  return (req, res, next) => {
    console.log(`auth: ${req.headers.authorization}`);
    if (req.headers.authorization === `Bearer ${strategies[PASSWORD]}`) { // this needs investigation, why add passport if I end up making the same authentication manually :shrughs:
      return next();
    }
    return res.status(401).send('Unauthorized');
  }
}
