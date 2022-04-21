import { Client4 } from "@mattermost/client";
import { applyQuery, QueryProviderEvent } from "../query/engine";
import { readPage } from "plugos-silverbullet-syscall/space";
import { parseMarkdown } from "plugos-silverbullet-syscall/markdown";
import { extractMeta } from "../query/data";
import { niceDate } from "../core/dates";
import { Post } from "@mattermost/types/lib/posts";

type AugmentedPost = Post & {
  // Dates we can use to filter
  createdAt: string;
  updatedAt: string;
  editedAt: string;
};

// https://community.mattermost.com/private-core/pl/rbp7a7jtr3f89nzsefo6ftqt3o

function mattermostDesktopUrlForPost(
  url: string,
  teamName: string,
  postId: string
) {
  return `${url.replace("https://", "mattermost://")}/${teamName}/pl/${postId}`;
}
type MattermostConfig = {
  url: string;
  token: string;
};

async function getConfig(): Promise<MattermostConfig> {
  let { text } = await readPage("mattermost-config");
  let parsedContent = await parseMarkdown(text);
  let pageMeta = await extractMeta(parsedContent);
  return pageMeta as MattermostConfig;
}

function augmentPost(post: AugmentedPost) {
  if (post.create_at) {
    post.createdAt = niceDate(new Date(post.create_at));
  }
  if (post.update_at) {
    post.updatedAt = niceDate(new Date(post.update_at));
  }
  if (post.edit_at) {
    post.editedAt = niceDate(new Date(post.edit_at));
  }
}

export async function savedPostsQueryProvider({
  query,
}: QueryProviderEvent): Promise<string> {
  let config = await getConfig();
  let client = new Client4();
  client.setUrl(config.url);
  client.setToken(config.token);
  let me = await client.getMe();
  let postCollection = await client.getFlaggedPosts(me.id);
  let savedPosts: AugmentedPost[] = [];
  for (let order of postCollection.order) {
    let post = postCollection.posts[order];
    augmentPost(post);
    savedPosts.push(post);
  }
  let savedPostsMd = [];
  savedPosts = applyQuery(query, savedPosts);
  for (let savedPost of savedPosts) {
    let channel = await client.getChannel(savedPost.channel_id);
    let team = await client.getTeam(channel.team_id);
    savedPostsMd.push(
      `@${(await client.getUser(savedPost.user_id)).username} [${
        savedPost.createdAt
      }](${mattermostDesktopUrlForPost(
        client.url,
        team.name,
        savedPost.id
      )}):\n> ${savedPost.message.substring(0, 1000).replaceAll(/\n/g, "\n> ")}`
    );
  }
  return savedPostsMd.join("\n\n");
}
