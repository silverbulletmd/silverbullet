import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { Button, Checkbox } from "@silverbulletmd/silverbullet/ui";

type Props = {
	ghostCount: number;
	onExpandAll: () => void;
	onCollapseAll: () => void;
	hideEdgeLabels: boolean;
	onToggleHideEdgeLabels: (v: boolean) => void;
	hideOrphans: boolean;
	onToggleHideOrphans: (v: boolean) => void;
	sidebarCollapsed: boolean;
	onToggleSidebar: () => void;
};

export function Header({
	ghostCount,
	onExpandAll,
	onCollapseAll,
	hideEdgeLabels,
	onToggleHideEdgeLabels,
	hideOrphans,
	onToggleHideOrphans,
	sidebarCollapsed,
	onToggleSidebar,
}: Props) {
	return (
		<header class="gv-header">
			<h1 class="gv-header-title">Object Graph</h1>
			<div class="gv-header-actions">
				<label
					class="gv-header-toggle"
					title="Suppress edge labels on the canvas"
				>
					<Checkbox
						checked={hideEdgeLabels}
						onChange={(e) =>
							onToggleHideEdgeLabels(
								(e.currentTarget as HTMLInputElement).checked,
							)
						}
					/>
					Hide labels
				</label>
				<label
					class="gv-header-toggle"
					title="Hide nodes with no visible incoming or outgoing relation"
				>
					<Checkbox
						checked={hideOrphans}
						onChange={(e) =>
							onToggleHideOrphans((e.currentTarget as HTMLInputElement).checked)
						}
					/>
					Hide orphans
				</label>
				<Button
					title="Follow every enabled relation outward until no ghosts remain"
					disabled={ghostCount === 0}
					onClick={onExpandAll}
				>
					Expand all
				</Button>
				<Button
					title="Reset view to the selected object and its direct relations"
					onClick={onCollapseAll}
				>
					Focus
				</Button>
				<Button
					variant="icon"
					title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
					onClick={onToggleSidebar}
				>
					{sidebarCollapsed ? "▷" : "◁"}
				</Button>
				<Button
					variant="icon"
					class="gv-close-button"
					title="Close (Esc)"
					onClick={() => editor.hidePanel("modal")}
				>
					×
				</Button>
			</div>
		</header>
	);
}
