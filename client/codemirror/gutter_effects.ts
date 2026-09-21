import { StateEffect } from "@codemirror/state";
import type { NamedEditorGutter } from "./gutter.ts";

/** Replaces all plug-provided gutters visible in the current editor state. */
export const setEditorGuttersEffect =
  StateEffect.define<readonly NamedEditorGutter[]>();
