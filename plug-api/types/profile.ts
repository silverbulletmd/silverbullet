export type ClientProfile = {
  username: string;
  fullName?: string;
};

/** One account with access to the space. `username` is absent where the
 * deployment keeps no accounts at all, and exactly one entry is marked `me`
 * whenever the current user is known. */
export type Account = {
  username: string | null;
  fullName?: string;
  me: boolean;
};
