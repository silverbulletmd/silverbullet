import { useEffect, useState } from "preact/hooks";
import {
  Alert,
  Input,
  SlidersIcon,
  ButtonLink,
} from "@silverbulletmd/silverbullet/ui";
import { api, formatApiError } from "../api.ts";
import { bindingLabel, spaceEntryUrl } from "../bindings.ts";
import { dashboardUrl } from "../routes.ts";
import type { VisibleSpace } from "../types.ts";

export function SpaceList({
  admin,
  onUnauthorized,
}: {
  admin: boolean;
  onUnauthorized: () => void;
}) {
  const [spaces, setSpaces] = useState<VisibleSpace[]>([]);
  const [encryptedLogin, setEncryptedLogin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [target, setTarget] = useState(-1);
  const filtered = spaces.filter((space) =>
    `${space.name} ${bindingLabel(space.binding)}`
      .toLocaleLowerCase()
      .includes(filter.trim().toLocaleLowerCase()),
  );

  const handleKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      setFilter("");
      setTarget(-1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        filtered.length === 0
          ? -1
          : event.key === "ArrowDown"
            ? Math.min(target + 1, filtered.length - 1)
            : target < 0
              ? filtered.length - 1
              : Math.max(target - 1, 0);
      setTarget(next);
      if ((event.currentTarget as HTMLElement).tagName === "LI") {
        document
          .getElementById(`space-row-${next}`)
          ?.querySelector<HTMLAnchorElement>(".sb-space-link")
          ?.focus();
      }
    } else if (
      event.key === "Enter" &&
      filtered[target] &&
      !(event.target as HTMLElement).closest(".sb-space-edit")
    ) {
      event.preventDefault();
      location.assign(spaceEntryUrl(filtered[target].binding, encryptedLogin));
    }
  };

  useEffect(() => {
    document
      .getElementById(`space-row-${target}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [target]);

  useEffect(() => {
    const encrypt = !!localStorage.getItem("enableEncryption");
    const central = encrypt
      ? fetch("/.auth/central/public").then(
          async (response) =>
            response.ok && !!(await response.json()).configured,
        )
      : Promise.resolve(false);
    Promise.all([api("GET", "api/spaces"), central])
      .then(([spaces, configured]: [VisibleSpace[], boolean]) => {
        setEncryptedLogin(configured);
        setSpaces(spaces);
        setLoaded(true);
      })
      .catch((error: any) => {
        if (error.unauthorized) onUnauthorized();
        else {
          setError(formatApiError(error));
          setLoaded(true);
        }
      });
  }, []);

  return (
    <div>
      <header class="sb-management-heading">
        <h1>Spaces</h1>
        {admin && (
          <a class="sb-button sb-button-primary" href={dashboardUrl("/new")}>
            Create space
          </a>
        )}
      </header>
      <Input
        class="sb-management-filter"
        aria-label="Filter spaces"
        aria-controls="spaces-list"
        placeholder="Filter spaces…"
        value={filter}
        onInput={(event) => {
          setFilter(event.currentTarget.value);
          setTarget(0);
        }}
        onKeyDown={handleKey}
      />
      {error && <Alert variant="error">{error}</Alert>}
      {!loaded && <p>Loading…</p>}
      {loaded && spaces.length === 0 && (
        <p>
          {admin
            ? "No spaces yet — create your first space."
            : "You don't have access to any spaces yet."}
        </p>
      )}
      {loaded && spaces.length > 0 && filtered.length === 0 && (
        <p>No matching spaces.</p>
      )}
      <ul id="spaces-list" class="sb-space-list sb-management-list">
        {filtered.map((space, index) => (
          <li
            key={space.id}
            id={`space-row-${index}`}
            class="sb-management-row"
            onFocus={() => setTarget(index)}
            onKeyDown={handleKey}
            data-target={target === index ? "true" : undefined}
          >
            <a
              class="sb-space-link sb-management-row-target"
              href={spaceEntryUrl(space.binding, encryptedLogin)}
            >
              <span class="sb-management-row-main">{space.name}</span>
              <span class="sb-management-row-detail">
                {bindingLabel(space.binding)}
              </span>
            </a>
            {admin && (
              <ButtonLink
                variant="icon"
                class="sb-space-edit"
                href={dashboardUrl(`/${encodeURIComponent(space.id)}`)}
                aria-label={`Settings for ${space.name}`}
                title={`Settings for ${space.name}`}
              >
                <SlidersIcon size={16} aria-hidden="true" />
              </ButtonLink>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
