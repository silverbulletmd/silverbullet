import { useEffect, useState } from "preact/hooks";
import { AnchoredMenu } from "../../components/anchored_menu.tsx";
import {
  ProfileAvatar,
  profileMenuHeader,
  profileMenuItems,
} from "../../components/profile_button.tsx";
import type { ProfileState } from "../../profile.ts";
import { getProfile } from "../api.ts";
import { useNavigate } from "../navigation.ts";
import { dashboardUrl } from "../routes.ts";

export function DashboardProfileMenu({
  username,
  admin,
  routeKey,
  onLogout,
  onUnauthorized,
}: {
  username: string;
  admin: boolean;
  routeKey: string;
  onLogout: () => void;
  onUnauthorized: () => void;
}) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileState>({
    status: "signed-in",
    username,
    admin,
    fullName: null,
  });
  const [trigger, setTrigger] = useState<HTMLElement>();
  const refresh = async () => {
    try {
      setProfile({ ...(await getProfile()), status: "signed-in" });
    } catch (error: any) {
      if (error.unauthorized) onUnauthorized();
    }
  };
  useEffect(() => {
    void refresh();
  }, [username]);
  useEffect(() => {
    setTrigger(undefined);
  }, [routeKey]);
  const Avatar = ProfileAvatar(profile);
  return (
    <>
      <button
        type="button"
        class="sb-dashboard-profile"
        aria-label="Profile menu"
        aria-haspopup="true"
        aria-expanded={!!trigger}
        onClick={(event) => {
          if (trigger) setTrigger(undefined);
          else {
            setTrigger(event.currentTarget);
            void refresh();
          }
        }}
      >
        <Avatar size={30} />
      </button>
      {trigger && (
        <AnchoredMenu
          trigger={trigger}
          header={profileMenuHeader(profile)}
          items={profileMenuItems(profile, {
            editProfile: () => navigate(dashboardUrl("/profile")),
            dashboard: () => navigate(dashboardUrl("/")),
            logIn: () => navigate(dashboardUrl("/login")),
            logOut: onLogout,
          })}
          onClose={() => setTrigger(undefined)}
        />
      )}
    </>
  );
}
