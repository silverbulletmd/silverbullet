export type LogoutRoute = {
  endpoint: string;
  method: "GET" | "POST";
  destination: string;
};

async function primaryUrl(fetchFn: typeof fetch): Promise<string | undefined> {
  try {
    const response = await fetchFn("/.auth/central/public");
    if (!response.ok) return;
    const { primaryUrl } = await response.json();
    if (typeof primaryUrl !== "string") return;
    const url = new URL(primaryUrl);
    if (["https:", "http:"].includes(url.protocol) && url.origin === primaryUrl)
      return primaryUrl;
  } catch {}
}

export async function dashboardUrl(
  path = "",
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  return `${(await primaryUrl(fetchFn)) ?? ""}/.dashboard${path}`;
}

export async function dashboardSessionRoutes(
  fetchFn: typeof fetch = fetch,
): Promise<{
  profile: string;
  logout: LogoutRoute;
}> {
  return (await primaryUrl(fetchFn))
    ? {
        profile: "/.auth/central/profile",
        logout: {
          endpoint: "/.auth/central/logout",
          method: "POST",
          destination: "/.auth/central/signed-out",
        },
      }
    : {
        profile: "/.dashboard/api/profile",
        logout: {
          endpoint: "/.dashboard/api/logout",
          method: "GET",
          destination: "/.dashboard/login?signedOut=true",
        },
      };
}
