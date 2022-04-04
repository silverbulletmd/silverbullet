import {useEffect, useRef} from "react";
// @ts-ignore
import iframeHtml from "bundle-text:./panel.html";
import {Simulate} from "react-dom/test-utils";

export function Panel({ html }: { html: string }) {
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
  return (
    <div className="panel">
      <iframe srcDoc={iframeHtml} ref={iFrameRef} />
    </div>
  );
}
