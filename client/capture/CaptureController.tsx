import { Button } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Client } from "../client.ts";
import type { ServiceMatch } from "../service_registry.ts";
import { CaptureView, type CaptureActionOption } from "./CaptureView.tsx";
import { CaptureInvocationContext } from "./invocation.ts";
import { openCaptureStore, type CaptureStore } from "./store.ts";
import type {
  CaptureActionData,
  CaptureDraft,
  CaptureRecord,
} from "./types.ts";

type Props = { client: Client; initialId?: string };

function editable(record: CaptureRecord): CaptureActionData {
  return {
    id: record.id,
    receivedAt: record.receivedAt,
    title: record.title,
    text: record.text,
    url: record.url,
    files: record.files,
  };
}

export function CaptureController({ client, initialId }: Props) {
  const ownerId = client.bootConfig.shareOwnerId;
  const [store, setStore] = useState<CaptureStore>();
  const [queue, setQueue] = useState<CaptureDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId);
  const [record, setRecord] = useState<CaptureRecord>();
  const [draft, setDraft] = useState<CaptureActionData>();
  const editedDrafts = useRef(new Map<string, CaptureActionData>());
  const [matches, setMatches] = useState<ServiceMatch[]>([]);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (
      !ownerId ||
      client.bootConfig.readOnly ||
      client.bootConfig.enableClientEncryption ||
      client.bootConfig.disableServiceWorker
    )
      return;
    let cancelled = false;
    const url = new URL("service_worker.js", document.baseURI).href;
    void openCaptureStore(url).then(async (opened) => {
      if (cancelled) return;
      setStore(opened);
      setQueue(await opened.list(ownerId));
    });
    return () => {
      cancelled = true;
    };
  }, [client, ownerId]);

  useEffect(() => {
    if (!store || !ownerId || !selectedId) return;
    let cancelled = false;
    void store.get(selectedId, ownerId).then((found) => {
      if (cancelled) return;
      setRecord(found);
      setDraft(
        found && (editedDrafts.current.get(found.id) ?? editable(found)),
      );
      setError(found ? undefined : "This capture is unavailable.");
    });
    return () => {
      cancelled = true;
    };
  }, [store, ownerId, selectedId]);

  useEffect(() => {
    if (!store || !ownerId) return;
    const check = () => {
      if (client.systemReady && client.fullIndexCompleted) {
        setReady(true);
        clearInterval(timer);
      }
    };
    const timer = setInterval(check, 250);
    check();
    const reload = async () => {
      await client.clientSystem.loadLuaScripts();
      setRevision((value) => value + 1);
      setReady(true);
    };
    client.eventHook.addLocalListener("editor:reloadState", reload);
    return () => {
      clearInterval(timer);
      client.eventHook.removeLocalListener("editor:reloadState", reload);
    };
  }, [client, store, ownerId]);

  useEffect(() => {
    if (!draft || !ready) return;
    let cancelled = false;
    void client.clientSystem.serviceRegistry
      .discover("capture", draft)
      .then((found) => {
        if (!cancelled) setMatches(found);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [client, draft, ready, revision]);

  if (!store || !ownerId || queue.length === 0) return null;

  const close = () => {
    setSelectedId(undefined);
    setRecord(undefined);
    setDraft(undefined);
    setError(undefined);
  };
  const refreshQueue = async (completedId: string) => {
    editedDrafts.current.delete(completedId);
    const remaining = await store.list(ownerId);
    setQueue(remaining);
    const next = remaining.find((item) => item.id !== completedId);
    setRecord(undefined);
    setDraft(undefined);
    setSelectedId(next?.id);
  };
  const actions: CaptureActionOption[] = matches
    .filter((match) => typeof match.name === "string")
    .map((match) => ({
      id: match.id!,
      name: match.name as string,
      description:
        typeof match.description === "string" ? match.description : undefined,
    }));

  if (!selectedId) {
    return (
      <Button
        class="sb-capture-pending"
        onClick={() => setSelectedId(queue[0].id)}
      >
        {queue.length} pending capture{queue.length === 1 ? "" : "s"}
      </Button>
    );
  }
  if (!record || !draft) {
    return (
      <div class="sb-modal-backdrop sb-capture-backdrop">
        <section class="sb-capture" role="alert">
          {error || "Opening capture…"}
          <Button onClick={close}>Close</Button>
        </section>
      </div>
    );
  }

  const run = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const match = matches.find((item) => item.id === id);
      if (!match) throw new Error("Capture action is no longer available");
      const context = new CaptureInvocationContext(store, ownerId);
      client.clientSystem.captureContext = context;
      try {
        await context.run(record, () =>
          client.clientSystem.serviceRegistry.invoke(match, draft),
        );
      } finally {
        client.clientSystem.captureContext = undefined;
      }
      await store.remove(record.id, ownerId);
      await refreshQueue(record.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CaptureView
      draft={draft}
      pendingCount={queue.length}
      actions={actions}
      loadingActions={!ready}
      busy={busy}
      error={error}
      onChange={(field, value) => {
        const edited = { ...draft, [field]: value };
        editedDrafts.current.set(record.id, edited);
        setDraft(edited);
      }}
      onRun={(id) => {
        void run(id);
      }}
      onDiscard={() => {
        void store
          .remove(record.id, ownerId)
          .then(() => refreshQueue(record.id))
          .catch((reason) => setError(String(reason)));
      }}
      onClose={close}
      onNext={() => {
        setRecord(undefined);
        setDraft(undefined);
        setSelectedId(
          queue[
            (queue.findIndex((item) => item.id === record.id) + 1) %
              queue.length
          ].id,
        );
      }}
    />
  );
}
