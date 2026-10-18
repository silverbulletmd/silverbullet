import { expect, test } from "vitest";
import { setPanelViews } from "../registry.ts";
import { PanelViewBody } from "./components/panel_view_body.tsx";
import { nativeBody, registerNativeView } from "./native_views.ts";

test("a plug's panel view gets the panel body, but never a built-in's", () => {
  const ownBody = () => null;
  registerNativeView("std.workbench", ownBody);
  setPanelViews([
    {
      def: { name: "example.map", title: "Map" },
      plug: "example",
      fn: "mapPanel",
    },
    { def: { name: "std.pages", title: "Pages" }, plug: "example", fn: "f" },
    {
      def: { name: "std.workbench", title: "Workbench" },
      plug: "example",
      fn: "f",
    },
  ]);
  try {
    expect(nativeBody("example.map")).toBe(PanelViewBody);
    expect(nativeBody("std.pages")).toBeUndefined();
    expect(nativeBody("std.workbench")).toBe(ownBody);
  } finally {
    setPanelViews([]);
  }
  expect(nativeBody("example.map")).toBeUndefined();
});
