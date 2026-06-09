import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { useEffect } from "preact/hooks";

export function useEscape() {
	useEffect(() => {
		const handler = async (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				await editor.hidePanel("modal");
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);
}
