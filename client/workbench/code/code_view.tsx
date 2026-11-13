import { useRef, useState } from "preact/hooks";
import { ScriptsView } from "../scripts/scripts_view.tsx";
import { useLoad } from "../shared/block_ui.tsx";
import {
  SectionSidebar,
  type SidebarItem,
  useNarrow,
} from "../shared/section_sidebar.tsx";
import { StylesView } from "../styles/styles_view.tsx";
import type { TabProps } from "../tab.ts";
import { useWorkbenchTarget } from "../workbench_target.ts";

export type CodeSection = "lua" | "style";

// Outlives the tab, which unmounts whenever the Workbench closes
let lastSection: CodeSection = "lua";

/** The Code tab: the space's `space-lua` and `space-style` blocks, one section each. */
export function CodeView(props: TabProps) {
  const { client } = props;
  const [section, setSection] = useState(lastSection);
  const show = (s: CodeSection) => {
    lastSection = s;
    setSection(s);
  };
  useWorkbenchTarget("Code", (t) => show(t.section));
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);
  const scripts = useLoad(client.clientSystem.spaceLuaEnv);
  const styles = useLoad(client.spaceStyles);
  const items: SidebarItem<CodeSection>[] = [
    { key: "lua", label: "Space Lua", count: scripts?.scripts.length },
    {
      key: "style",
      label: "Space Style",
      count: styles?.styles.filter((s) => s.active).length,
    },
  ];
  return (
    <div className="sb-workbench sb-wb-code" ref={root}>
      <div className="sb-wb-code-layout">
        <SectionSidebar
          label="Code sections"
          items={items}
          active={section}
          compact={narrow}
          onSelect={show}
        />
        <div className="sb-wb-code-main">
          {section === "lua" ? (
            <ScriptsView {...props} />
          ) : (
            <StylesView {...props} />
          )}
        </div>
      </div>
    </div>
  );
}
