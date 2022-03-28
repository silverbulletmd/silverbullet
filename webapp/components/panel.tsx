import { useRef } from "react";

export function Panel({ html }: { html: string }) {
  const iFrameRef = useRef<HTMLIFrameElement>(null);
  // @ts-ignore
  window.iframeRef = iFrameRef;
  return (
    <div className="panel">
      <iframe srcDoc={html} ref={iFrameRef} />
    </div>
  );
}
