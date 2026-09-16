import { Input, Select, UrlPrefixInput } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import {
  bindingFromAddress,
  bindingHostOptions,
  createBindingDraft,
  customHostOrigin,
  normalizeHostAuthority,
  resolvePublicOrigin,
  selectBindingHost,
  validHostAuthority,
} from "../binding_fields.ts";
import type { Binding, VisibleSpace } from "../types.ts";

export function BindingFields({
  binding,
  primaryUrl,
  spaces,
  currentId,
  onInput,
}: {
  binding: Binding;
  primaryUrl?: string | null;
  spaces: VisibleSpace[];
  currentId?: string;
  onInput: (binding: Binding) => void;
}) {
  const publicOrigin = resolvePublicOrigin(primaryUrl, location.origin);
  const primaryScope = normalizeHostAuthority(publicOrigin.host);
  const [initialHost] = useState(binding.host);
  const grouped = bindingHostOptions(spaces, primaryScope, currentId);
  const options = grouped.custom;
  const initialScope = initialHost && normalizeHostAuthority(initialHost);
  if (
    initialHost &&
    initialScope !== primaryScope &&
    !options.some((option) => option.host === initialScope)
  ) {
    options.push({
      host: initialScope!,
      displayHost: initialHost,
      prefixes: [],
      rootOccupied: false,
      label: initialHost,
    });
  }
  const [draft, setDraft] = useState(() =>
    createBindingDraft(binding, primaryScope),
  );
  const { choice, newHost } = draft;
  const path = binding.prefix ?? "/";
  const [hostStatus, setHostStatus] = useState<
    "checking" | "verified" | "mismatch" | "unreachable" | null
  >(null);
  const validNewHost = validHostAuthority(newHost);
  const probeOrigin = validNewHost
    ? customHostOrigin(newHost, publicOrigin)
    : publicOrigin.origin;
  const invalidHost = choice === "new" && !!newHost && !validNewHost;

  useEffect(() => {
    setHostStatus(null);
    if (choice !== "new" || !validNewHost) return;
    let active = true;
    const timer = setTimeout(async () => {
      setHostStatus("checking");
      try {
        const own = await (
          await fetch("/.instance", { signal: AbortSignal.timeout(4000) })
        ).json();
        const remote = await (
          await fetch(`${probeOrigin}/.instance`, {
            signal: AbortSignal.timeout(4000),
          })
        ).json();
        if (active)
          setHostStatus(
            remote.instance === own.instance ? "verified" : "mismatch",
          );
      } catch {
        if (active) setHostStatus("unreachable");
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [choice, newHost, invalidHost, probeOrigin]);

  const addressOrigin =
    binding.host && validHostAuthority(binding.host)
      ? customHostOrigin(binding.host, publicOrigin)
      : publicOrigin.origin;
  const primaryHost = publicOrigin.host;
  const primaryLabel = grouped.primary.prefixes.length
    ? `Primary hostname — ${primaryHost} — ${grouped.primary.prefixes.join(", ")}`
    : `Primary hostname — ${primaryHost}`;

  return (
    <>
      <label for="space-hostname">Hostname</label>
      <Select
        id="space-hostname"
        value={choice}
        onChange={(event) => {
          const next = event.currentTarget.value;
          const host =
            next === "primary"
              ? null
              : next === "new"
                ? undefined
                : options.find((option) => `host:${option.host}` === next)!
                    .displayHost;
          const result = selectBindingHost(draft, binding, host);
          setDraft(result.draft);
          onInput(result.binding);
        }}
      >
        <option
          value="primary"
          disabled={
            grouped.primary.rootOccupied &&
            !(currentId && (!initialScope || initialScope === primaryScope))
          }
        >
          {primaryLabel}
        </option>
        {options.map((option) => (
          <option
            key={option.host}
            value={`host:${option.host}`}
            disabled={
              option.rootOccupied &&
              !(currentId && option.host === initialScope)
            }
          >
            {option.label}
          </option>
        ))}
        <option value="new">New hostname</option>
      </Select>
      {choice === "new" && (
        <>
          <label for="space-new-hostname">New hostname</label>
          <Input
            id="space-new-hostname"
            value={newHost}
            placeholder="notes.example.com or notes.home:3000"
            onInput={(event) => {
              const host = event.currentTarget.value;
              setDraft({ ...draft, newHost: host });
              onInput(bindingFromAddress(host, path));
            }}
          />
        </>
      )}
      <label for="space-binding-path">Path</label>
      <UrlPrefixInput
        id="space-binding-path"
        origin={addressOrigin}
        value={path}
        onInput={(prefix) =>
          onInput(bindingFromAddress(binding.host ?? null, prefix))
        }
      />
      {invalidHost && (
        <span role="status" class="sb-dashboard-error">
          Use an ASCII DNS name or canonical IPv4 address, optionally followed
          by a port from 1 to 65535.
        </span>
      )}
      {!invalidHost && hostStatus && (
        <span
          role="status"
          class={
            hostStatus === "verified"
              ? "sb-dashboard-ok"
              : hostStatus === "mismatch"
                ? "sb-dashboard-error"
                : "sb-dashboard-warn"
          }
        >
          {hostStatus === "checking"
            ? "Checking hostname…"
            : hostStatus === "verified"
              ? "✓ hostname reaches this server"
              : hostStatus === "mismatch"
                ? "hostname reaches a different server"
                : "could not verify: hostname does not reach this server from your browser (DNS or proxy not set up yet?)"}
        </span>
      )}
    </>
  );
}
