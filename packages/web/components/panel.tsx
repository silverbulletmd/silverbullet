import { useEffect, useRef } from "react";
// @ts-ignore
import iframeHtml from "bundle-text:./panel.html";
import { System } from "@plugos/plugos/system";
import { SilverBulletHooks } from "@silverbulletmd/common/manifest";
import { Editor } from "../editor";

export function Panel({
  html,
  script,
  flex,
  editor,
}: {
  html: string;
  script?: string;
  flex: number;
  editor: Editor;
}) {
  const iFrameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    function loadContent() {
      if (iFrameRef.current?.contentWindow) {
        iFrameRef.current.contentWindow.postMessage({
          type: "html",
          html: html,
          script: script,
        });
      }
    }
    if (!iFrameRef.current) {
      return;
    }
    let iframe = iFrameRef.current;
    iframe.onload = loadContent;
    loadContent();
    return () => {
      iframe.onload = null;
    };
  }, [html]);

  useEffect(() => {
    let messageListener = (evt: any) => {
      if (evt.source !== iFrameRef.current!.contentWindow) {
        return;
      }
      let data = evt.data;
      if (!data) return;
      if (data.type === "event") {
        editor.dispatchAppEvent(data.name, data.args);
      }
    };
    window.addEventListener("message", messageListener);
    return () => {
      window.removeEventListener("message", messageListener);
    };
  }, []);

  return (
    <div className="panel" style={{ flex }}>
      <iframe srcDoc={iframeHtml} ref={iFrameRef} />
    </div>
  );
}
