import manifest from "./manifest";
import React, { useEffect, useRef } from "react";
import { Editor } from "@silverbulletmd/web/editor";
import { HttpSpacePrimitives } from "@silverbulletmd/common/spaces/http_space_primitives";
import { safeRun } from "@plugos/plugos/util";
import { Space } from "@silverbulletmd/common/spaces/space";

import "../../../packages/web/styles/main.scss";
import "./styles.scss";

function loadSheet(file: string) {
  var sbCSS = document.createElement("link");
  sbCSS.rel = "stylesheet";
  sbCSS.type = "text/css";
  sbCSS.href = `/static/plugins/silverbullet/${file}`;
  document.getElementsByTagName("head")[0].appendChild(sbCSS);
}

const MainApp = (): React.ReactElement => {
  let ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    loadSheet("index.css");

    safeRun(async () => {
      let httpPrimitives = new HttpSpacePrimitives("/plugins/silverbullet", "");
      const editor = new Editor(
        new Space(httpPrimitives, true),
        ref.current!,
        "/plugins/silverbullet"
      );
      await editor.init();
    });
  }, []);
  return (
    <div id="sb-root" ref={ref}>
      This is Silver Bullet
    </div>
  );
};

export default class Plugin {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  public async initialize(registry: any, store: any) {
    // @see https://developers.mattermost.com/extend/plugins/webapp/reference/
    console.log("SUP YALL SILVER BULLET!!!");

    registry.registerProduct(
      "/plugins/silverbullet",
      "product-boards",
      "Silver Bullet",
      "/plugins/silverbullet",
      MainApp
    );
  }
}

declare global {
  interface Window {
    registerPlugin(id: string, plugin: Plugin): void;
  }
}

window.registerPlugin(manifest.id, new Plugin());
