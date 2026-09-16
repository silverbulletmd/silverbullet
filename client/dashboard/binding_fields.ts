import type { Binding, VisibleSpace } from "./types.ts";

export type HostOption = {
  host: string;
  displayHost: string;
  prefixes: string[];
  rootOccupied: boolean;
  label: string;
};

export type BindingDraft = {
  choice: "primary" | "new" | `host:${string}`;
  paths: Record<string, string>;
  newHost: string;
};

export type PublicOrigin = {
  origin: string;
  host: string;
  hostname: string;
  protocol: string;
  port: string;
};

function publicOrigin(url: URL): PublicOrigin {
  return {
    origin: url.origin,
    host: url.host,
    hostname: url.hostname,
    protocol: url.protocol,
    port: url.port,
  };
}

export function resolvePublicOrigin(
  primaryUrl: string | null | undefined,
  fallbackOrigin: string,
): PublicOrigin {
  const fallback = new URL(fallbackOrigin);
  try {
    const candidate = new URL(primaryUrl ?? "");
    if (
      candidate.host &&
      (candidate.protocol === "http:" || candidate.protocol === "https:")
    ) {
      return publicOrigin(candidate);
    }
  } catch {
    // The Primary URL is a controlled text field and is routinely partial.
  }
  return publicOrigin(fallback);
}

export function customHostOrigin(host: string, origin: PublicOrigin): string {
  return `${origin.protocol}//${host}`;
}

export function validHostAuthority(host: string): boolean {
  if (
    !host ||
    host.trim() !== host ||
    [...host].some((character) => character.charCodeAt(0) > 127) ||
    /[\\/?#@]/.test(host)
  )
    return false;
  const colon = host.indexOf(":");
  let bare = colon === -1 ? host : host.slice(0, colon);
  if (colon !== -1) {
    const port = host.slice(colon + 1);
    if (
      host.indexOf(":", colon + 1) !== -1 ||
      !/^[1-9]\d{0,4}$/.test(port) ||
      Number(port) > 65535
    )
      return false;
  }
  bare = bare.endsWith(".") ? bare.slice(0, -1) : bare;
  if (!bare || bare.length > 253) return false;
  try {
    if (
      new URL(`http://${bare}/`).hostname.toLowerCase() !== bare.toLowerCase()
    )
      return false;
  } catch {
    return false;
  }
  const labels = bare.split(".");
  if (labels.length === 4 && labels.every((label) => /^\d+$/.test(label))) {
    return labels.every(
      (label) => /^(0|[1-9]\d{0,2})$/.test(label) && Number(label) <= 255,
    );
  }
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      !label.startsWith("-") &&
      !label.endsWith("-") &&
      /^[A-Za-z0-9-]+$/.test(label),
  );
}

export function normalizeHostAuthority(host: string): string {
  const trimmed = host.trim();
  const colon = trimmed.indexOf(":");
  const hostname = (colon === -1 ? trimmed : trimmed.slice(0, colon)).replace(
    /\.+$/,
    "",
  );
  return `${hostname}${colon === -1 ? "" : trimmed.slice(colon)}`.toLowerCase();
}

function displayHost(host: string): string {
  const trimmed = host.trim();
  const colon = trimmed.indexOf(":");
  const hostname = (colon === -1 ? trimmed : trimmed.slice(0, colon)).replace(
    /\.+$/,
    "",
  );
  return `${hostname}${colon === -1 ? "" : trimmed.slice(colon)}`;
}

function hostChoice(
  host: string | null | undefined,
  primaryHost?: string,
): BindingDraft["choice"] {
  return host === null
    ? "primary"
    : host === undefined
      ? "new"
      : normalizeHostAuthority(host) === primaryHost
        ? "primary"
        : `host:${normalizeHostAuthority(host)}`;
}

export function createBindingDraft(
  binding: Binding,
  primaryHost?: string,
): BindingDraft {
  return {
    choice: hostChoice(binding.host ?? null, primaryHost),
    paths: {},
    newHost: "",
  };
}

export function selectBindingHost(
  draft: BindingDraft,
  binding: Binding,
  host: string | null | undefined,
): { draft: BindingDraft; binding: Binding } {
  const choice = hostChoice(host);
  const paths = { ...draft.paths, [draft.choice]: binding.prefix ?? "/" };
  return {
    draft: { ...draft, choice, paths },
    binding: bindingFromAddress(
      host === undefined ? draft.newHost : host,
      paths[choice] ?? "/",
    ),
  };
}

export function bindingPrefix(binding: Binding): string {
  return binding.prefix || "/";
}

export function bindingFromAddress(
  host: string | null,
  prefix: string,
): Binding {
  if (host === null) return { prefix };
  const normalizedPrefix = bindingPrefix({ prefix });
  return normalizedPrefix === "/"
    ? { host }
    : { host, prefix: normalizedPrefix };
}

export function hostOptions(
  spaces: VisibleSpace[],
  currentId?: string,
): HostOption[] {
  return bindingHostOptions(spaces, undefined, currentId).custom;
}

function makeHostOption(
  host: string,
  displayHost: string,
  prefixes: Set<string>,
): HostOption {
  const sorted = [...prefixes].sort((a, b) => a.localeCompare(b));
  return {
    host,
    displayHost,
    prefixes: sorted,
    rootOccupied: sorted.includes("/"),
    label: sorted.length
      ? `${displayHost} — ${sorted.join(", ")}`
      : displayHost,
  };
}

export function bindingHostOptions(
  spaces: VisibleSpace[],
  primaryHost: string | undefined,
  currentId?: string,
): { primary: HostOption; custom: HostOption[] } {
  const options = new Map<
    string,
    { displayHost: string; prefixes: Set<string> }
  >();
  const primaryPrefixes = new Set<string>();

  for (const space of spaces) {
    const rawHost = space.binding.host?.trim();
    const displayedHost = rawHost && displayHost(rawHost);
    if (!displayedHost) {
      if (space.id !== currentId)
        primaryPrefixes.add(bindingPrefix(space.binding));
      continue;
    }
    const host = displayedHost.toLowerCase();
    if (host === primaryHost) {
      if (space.id !== currentId)
        primaryPrefixes.add(bindingPrefix(space.binding));
      continue;
    }
    const option = options.get(host) ?? {
      displayHost: displayedHost,
      prefixes: new Set<string>(),
    };
    if (space.id !== currentId)
      option.prefixes.add(bindingPrefix(space.binding));
    options.set(host, option);
  }

  const custom = [...options.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, option]) =>
      makeHostOption(host, option.displayHost, option.prefixes),
    );
  return {
    primary: makeHostOption(
      primaryHost ?? "",
      primaryHost ?? "",
      primaryPrefixes,
    ),
    custom,
  };
}
