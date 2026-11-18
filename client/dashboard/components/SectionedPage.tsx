import { SectionNav } from "@silverbulletmd/silverbullet/ui";
import type { ComponentChild } from "preact";
import { useNavigate } from "../navigation.ts";
import { dashboardUrl } from "../routes.ts";

/**
 * A top-level dashboard page split into sections, each at
 * `<path>?section=<id>`. `panels` must cover every section in `labels`.
 */
export function SectionedPage<S extends string>({
  title,
  path,
  labels,
  section,
  panels,
}: {
  title: string;
  path: string;
  labels: Record<S, string>;
  section: S;
  panels: Record<S, () => ComponentChild>;
}) {
  const navigate = useNavigate();
  const sectionUrl = (id: string) => dashboardUrl(`${path}?section=${id}`);
  return (
    <main class="sb-space-settings">
      <header class="sb-settings-heading">
        <div>
          <h1>{title}</h1>
        </div>
      </header>
      <div class="sb-settings-layout sb-management-server-settings">
        <SectionNav
          horizontal
          label={title}
          active={section}
          items={Object.entries<string>(labels).map(([id, label]) => ({
            id,
            label,
            href: sectionUrl(id),
          }))}
          onSelect={(id) => navigate(sectionUrl(id))}
        />
        <div class="sb-settings-content">{panels[section]()}</div>
      </div>
    </main>
  );
}
