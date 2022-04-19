import { MattermostClient } from "./client";
import { applyQuery, QueryProviderEvent } from "../query/engine";

// https://community.mattermost.com/private-core/pl/rbp7a7jtr3f89nzsefo6ftqt3o

function mattermostDesktopUrlForPost(
  url: string,
  teamName: string,
  postId: string
) {
  return `${url.replace("https://", "mattermost://")}/${teamName}/pl/${postId}`;
}

export async function savedPostsQueryProvider({
  query,
}: QueryProviderEvent): Promise<string> {
  let client = await MattermostClient.fromConfig();
  let me = await client.getMe();
  let savedPosts = await client.getFlaggedPosts(me.id);
  let savedPostsMd = [];
  savedPosts = applyQuery(query, savedPosts);
  for (let savedPost of savedPosts) {
    // savedPost.
    let channel = await client.getChannel(savedPost.channel_id);
    let team = await client.getTeam(channel.team_id);
    savedPostsMd.push(
      `@${
        (await client.getUser(savedPost.user_id)).username
      } [link](${mattermostDesktopUrlForPost(
        client.url,
        team.name,
        savedPost.id
      )}):\n> ${savedPost.message.replaceAll(/\n/g, "\n> ")}`
    );
  }
  return savedPostsMd.join("\n\n");
}
