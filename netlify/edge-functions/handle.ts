export default async function handleMarkdown(
  request: Request,
  ctx: any,
): Promise<Response> {
  const resp = await ctx.next(request);
  if (resp.status === 404) {
    return new Response("", {
      status: 200,
      headers: { "Content-Type": "text/markdown" },
    });
  } else {
    return resp;
  }
}

export const config = { path: "/*.md" };
