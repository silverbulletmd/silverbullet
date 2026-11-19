import type { FunctionalComponent } from "preact";
import { Icon } from "@silverbulletmd/silverbullet/ui";

const components = new Map<string, FunctionalComponent<{ size?: number }>>();

/** An icon name as a `{ size }` component, for UI that takes icon components (action buttons). */
export function iconComponent(
  name: string,
): FunctionalComponent<{ size?: number }> {
  let component = components.get(name);
  if (!component) {
    component = ({ size }) => <Icon name={name} size={size} />;
    components.set(name, component);
  }
  return component;
}
