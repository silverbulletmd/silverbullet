import type { KitInfo } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api.ts";
import { useSlugDefaults } from "../space_fields.tsx";
import { listStarterKits } from "../starter_kits.ts";
import type { Binding, FieldError, RevisionsMode } from "../types.ts";
import {
  type AdminValues,
  DEFAULT_STARTER,
  defaultFolder,
  type SpaceValues,
  type StarterValues,
  spacePayload,
  validateAdmin,
  validateSpace,
} from "../wizard.ts";
import { useFolderHasNotes } from "./NewSpaceStarter.tsx";
import { AdminStep } from "./wizard/AdminStep.tsx";
import { DoneStep } from "./wizard/DoneStep.tsx";
import { SpaceStep } from "./wizard/SpaceStep.tsx";

type Step = "admin" | "space" | "done";

export function Wizard() {
  // Gates rendering until `api/status` has reported the data root, so the
  // folder field is never shown un-prepopulated.
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState<Step>("admin");

  const [admin, setAdmin] = useState<AdminValues>({
    username: "admin",
    password: "",
    password2: "",
    fullName: "",
    email: "",
  });

  const [spaceName, setSpaceName] = useState("Notes");
  const [revisions, setRevisions] = useState<RevisionsMode>("managed");
  const [primaryUrl, setPrimaryUrl] = useState(location.origin);
  // The server's absolute data root, reported by `api/status`. The folder
  // field is prepopulated with an absolute path under it so the user never has
  // to know (or care) which directory the server was booted on.
  const [root, setRoot] = useState("");
  const { prefix, folder, onNameChange, setPrefix, setFolder } =
    useSlugDefaults((slug) => defaultFolder(root, slug));
  const [hostBinding, setHostBinding] = useState<Binding | null>(null);
  const binding = hostBinding ?? { prefix };

  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

  const [kits, setKits] = useState<KitInfo[]>();
  const [kitsFailed, setKitsFailed] = useState(false);
  const [starter, setStarter] =
    useState<Omit<StarterValues, "hasNotes">>(DEFAULT_STARTER);
  const hasNotes = useFolderHasNotes(
    "setup",
    step === "space" && starter.choice.type === "kit",
    folder,
  );

  const space: SpaceValues = {
    name: spaceName,
    binding,
    folder,
    revisions,
    starter: { ...starter, hasNotes },
  };

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("api/status");
        const j = await r.json();
        const serverRoot = typeof j.root === "string" ? j.root : "";
        setRoot(serverRoot);
        setLoaded(true);
      } catch {
        // Leave `loaded` false; the loading state just persists. A refresh will
        // retry once the server is reachable again.
      }
    })();
  }, []);

  useEffect(() => {
    listStarterKits("setup")
      .then(setKits)
      .catch(() => setKitsFailed(true));
  }, []);

  // Seed the prefix/folder defaults from the initial "Notes" space name once
  // the data root is known. `onNameChange`'s folder template closes over
  // `root`, which is only current once the render triggered by `setRoot`
  // above has landed — hence a separate effect keyed on `loaded` rather than
  // doing this inline in the fetch above.
  useEffect(() => {
    if (loaded) onNameChange(spaceName);
  }, [loaded]);

  function submitAdmin() {
    const problems = validateAdmin(admin);
    setErrors(problems);
    if (problems.length > 0) return;
    setStep("space");
  }

  async function submitSpace() {
    const problems = validateSpace(space);
    setErrors(problems);
    if (problems.length > 0) return;

    setBusy(true);
    try {
      await api("POST", "api/complete", {
        primaryUrl: primaryUrl.trim(),
        adminUsername: admin.username,
        adminPassword: admin.password,
        adminFullName: admin.fullName,
        adminEmail: admin.email,
        space: spacePayload(space),
      });
      setStep("done");
    } catch (errs) {
      setErrors(
        Array.isArray(errs) ? errs : [{ field: "", message: "Request failed" }],
      );
      setBusy(false);
    }
  }

  if (!loaded) return <p>Loading…</p>;

  switch (step) {
    case "admin":
      return (
        <AdminStep
          values={admin}
          onChange={(patch) => setAdmin({ ...admin, ...patch })}
          errors={errors}
          busy={busy}
          onSubmit={submitAdmin}
        />
      );
    case "space":
      return (
        <SpaceStep
          values={space}
          root={root}
          onNameInput={(name) => {
            setSpaceName(name);
            onNameChange(name);
          }}
          primaryUrl={primaryUrl}
          onPrimaryUrlChange={setPrimaryUrl}
          onBindingChange={(next) => {
            if (next.host !== undefined) setHostBinding(next);
            else {
              setHostBinding(null);
              if (!hostBinding && next.prefix !== prefix)
                setPrefix(next.prefix);
            }
          }}
          onFolderChange={setFolder}
          onRevisionsChange={setRevisions}
          kits={kits}
          kitsFailed={kitsFailed}
          onStarterChange={(patch) => setStarter({ ...starter, ...patch })}
          errors={errors}
          busy={busy}
          onBack={() => {
            setErrors([]);
            setStep("admin");
          }}
          onSubmit={() => void submitSpace()}
        />
      );
    case "done":
      return (
        <DoneStep target={`${new URL(primaryUrl.trim()).origin}/.dashboard/`} />
      );
  }
}
