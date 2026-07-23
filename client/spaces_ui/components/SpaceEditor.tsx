import { useEffect, useState } from "preact/hooks";
import { Alert } from "@silverbulletmd/silverbullet/ui";
import { adminApi, formatApiError } from "../api.ts";
import { useNavigate } from "../navigation.ts";
import { spacesUrl } from "../routes.ts";
import type { SpaceInfo } from "../types.ts";
import { SpaceForm } from "./SpaceForm.tsx";

export function SpaceEditor({
  id,
  onUnauthorized,
}: {
  id?: string;
  onUnauthorized: () => void;
}) {
  const navigate = useNavigate();
  const [space, setSpace] = useState<SpaceInfo | undefined>(undefined);
  const [loaded, setLoaded] = useState(!id);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    adminApi("GET", `spaces/${encodeURIComponent(id)}`)
      .then((space) => {
        setSpace(space);
        setLoaded(true);
      })
      .catch((error: any) => {
        if (error.unauthorized) onUnauthorized();
        else if (error.notFound) setNotFound(true);
        else setError(formatApiError(error));
        setLoaded(true);
      });
  }, [id]);

  if (!loaded) return <p>Loading…</p>;
  if (notFound) {
    return (
      <div>
        <h1>Space not found</h1>
        <p>
          <a href={spacesUrl("/")}>Return to spaces</a>
        </p>
      </div>
    );
  }
  if (error) return <Alert variant="error">{error}</Alert>;
  return (
    <SpaceForm
      id={id}
      initial={space}
      cancelHref={spacesUrl("/")}
      onSaved={(savedId) =>
        navigate(spacesUrl(`/${encodeURIComponent(savedId)}`))
      }
      onDeleted={() => navigate(spacesUrl("/"))}
      onUnauthorized={onUnauthorized}
    />
  );
}
