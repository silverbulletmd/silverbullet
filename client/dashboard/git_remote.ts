export type Provider = "github" | "gitlab" | "forgejo" | "bitbucket" | "other";

export type ParsedRemote = {
  host: string;
  path: string;
  sshUrl: string;
  provider: Provider;
  deployKeyUrl?: string;
};

const KNOWN_HOSTS: Record<string, Provider> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "codeberg.org": "forgejo",
  "bitbucket.org": "bitbucket",
};

// Web-UI segments that follow owner/repo. Everything from one of these on is
// chrome, not part of the repository path.
const UI_SEGMENTS = new Set([
  "tree",
  "blob",
  "commit",
  "commits",
  "src",
  "raw",
  "pull",
  "pulls",
  "issues",
  "releases",
  "wiki",
  "settings",
  "actions",
]);

export function deployKeyUrl(
  host: string,
  path: string,
  provider: Provider,
): string | undefined {
  const base = `https://${host}/${path}`;
  switch (provider) {
    case "github":
      return `${base}/settings/keys/new`;
    case "gitlab":
      return `${base}/-/settings/repository`;
    case "forgejo":
      return `${base}/settings/keys`;
    case "bitbucket":
      return `${base}/admin/access-keys/`;
    default:
      return undefined;
  }
}

function trimPath(segments: string[]): string[] {
  // GitLab delimits its web UI with `/-/`. Use the last `-` segment, not the
  // first: a group or project literally named `-` would otherwise be
  // mistaken for the delimiter.
  const dash = segments.lastIndexOf("-");
  if (dash >= 2) return segments.slice(0, dash);
  // Elsewhere owner/repo is always the first two segments.
  if (segments.length > 2 && UI_SEGMENTS.has(segments[2])) {
    return segments.slice(0, 2);
  }
  return segments;
}

export function parseRepoUrl(
  input: string,
  providerHint?: Provider,
): ParsedRemote | null {
  const raw = input.trim();
  if (!raw) return null;

  let host: string;
  let rest: string;
  let port: string | undefined;

  const isHttp = /^https?:\/\//i.test(raw);
  const isSsh = /^ssh:\/\//i.test(raw);

  if (isHttp || isSsh) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    host = url.hostname.toLowerCase().replace(/^www\./, "");
    rest = url.pathname;
    if (isSsh && url.port) port = url.port;
  } else {
    // Bare scp shorthand: `git@host:path`. Unlike `ssh://`, this syntax has
    // no port concept, so a colon here is always part of the path.
    const scp = raw.match(/^(?:git@)?([^/:@\s]+\.[^/:@\s]+):(.+)$/);
    if (!scp) return null;
    host = scp[1].toLowerCase().replace(/^www\./, "");
    rest = scp[2];
  }

  const segments = trimPath(
    rest
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean),
  );
  if (segments.length < 2) return null;

  const path = segments.join("/").replace(/\.git$/i, "");
  const provider = KNOWN_HOSTS[host] ?? providerHint ?? "other";
  // scp shorthand can't express a port, so only fall back to `ssh://` when
  // the input actually carried one.
  const sshUrl = port
    ? `ssh://git@${host}:${port}/${path}.git`
    : `git@${host}:${path}.git`;
  return {
    host,
    path,
    sshUrl,
    provider,
    deployKeyUrl: deployKeyUrl(host, path, provider),
  };
}
