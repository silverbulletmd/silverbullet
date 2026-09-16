import { Alert } from "@silverbulletmd/silverbullet/ui";
import { type ComponentChildren, createContext } from "preact";
import { useCallback, useContext, useState } from "preact/hooks";

type Confirmation = { scope: string; message: string };
const Notifications = createContext<{
  confirmation?: Confirmation;
  notify: (scope: string, message: string) => void;
}>({ notify: () => {} });

export function useNotification(scope: string) {
  const { notify } = useContext(Notifications);
  return useCallback(
    (message: string) => notify(scope, message),
    [notify, scope],
  );
}

export function SaveConfirmation({ scope }: { scope: string }) {
  const { confirmation } = useContext(Notifications);
  if (confirmation?.scope !== scope || !confirmation.message) return null;
  return (
    <Alert variant="info">
      <span role="status">{confirmation.message}</span>
    </Alert>
  );
}

export function NotificationProvider({
  children,
}: {
  children: ComponentChildren;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const notify = useCallback((scope: string, message: string) => {
    setConfirmation({ scope, message });
  }, []);
  return (
    <Notifications.Provider value={{ confirmation, notify }}>
      {children}
    </Notifications.Provider>
  );
}
