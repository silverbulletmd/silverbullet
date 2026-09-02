import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";
import { placeMenu } from "./menu_placement.ts";

export type MenuItem = {
  name: string;
  run: () => void;
};

export function AnchoredMenu({
  trigger,
  header,
  items,
  onClose,
}: {
  trigger: HTMLElement;
  header?: { title: string; subtitle?: string };
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The parent re-renders on unrelated state and passes a fresh `onClose` each
  // time. Reading it through a ref keeps the listeners below registered once
  // instead of being torn down and re-added on every one of those renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const placement = placeMenu(trigger.getBoundingClientRect(), {
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  });

  // Layout, not passive: `useEffect` is deferred to an animation frame, and a
  // click arriving in that window would find no listener and be dropped.
  useLayoutEffect(() => {
    // The trigger's own children are part of the trigger: without this a click
    // on the avatar inside the button would close and immediately reopen.
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !trigger.contains(target)) {
        onCloseRef.current();
      }
    };
    const onResize = () => onCloseRef.current();
    document.addEventListener("pointerdown", onPointer);
    // Placement is measured once, so a resize would leave the menu behind.
    globalThis.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      globalThis.removeEventListener("resize", onResize);
    };
  }, [trigger]);

  return createPortal(
    <div
      ref={ref}
      className="sb-anchored-menu"
      style={{
        top: `${placement.top}px`,
        right: `${placement.right}px`,
        maxWidth: `${placement.maxWidth}px`,
      }}
    >
      {header && (
        <div className="sb-anchored-menu-header">
          <span className="sb-anchored-menu-title">{header.title}</span>
          {header.subtitle && (
            <span className="sb-anchored-menu-subtitle">{header.subtitle}</span>
          )}
        </div>
      )}
      {items.map((item) => (
        <button
          key={item.name}
          type="button"
          onClick={() => {
            onCloseRef.current();
            item.run();
          }}
        >
          {item.name}
        </button>
      ))}
    </div>,
    document.body,
  );
}
