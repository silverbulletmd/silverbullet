import { useEffect, useRef } from "react";
// @ts-ignore
import iframeHtml from "bundle-text:./panel.html";

export function Panel({ html, flex }: { html: string; flex: number }) {
  const iFrameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    function loadContent() {
      if (iFrameRef.current?.contentWindow) {
        iFrameRef.current.contentWindow.postMessage({
          type: "html",
          html: html,
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
      console.log("Got message from panel", data);
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
