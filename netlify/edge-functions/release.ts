import type { Config } from "https://edge.netlify.com";

export const config: Config = {
  path: "/",
};

export default async function handler(req: Request): Promise<Response> {
  console.log("HERE");
  const res = await fetch(
    "https://github.com/silverbulletmd/silverbullet/releases/latest/download/silverbullet.js",
  );
  return new Response(res.body, {
    headers: {
      ...res.headers,
      "Content-type": "application/javascript",
    },
  });
}
