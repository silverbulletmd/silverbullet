import { Client4 } from "@mattermost/client";
import { applyQuery, QueryProviderEvent } from "../query/engine";
import { readPage } from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { extractMeta } from "../query/data";
import { niceDate } from "../core/dates";
import { Post } from "@mattermost/types/lib/posts";
import { ServerChannel } from "@mattermost/types/lib/channels";
import { UserProfile } from "@mattermost/types/lib/users";
import { Team } from "@mattermost/types/lib/teams";

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
  defaultTeam: string;
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

class CachingClient4 {
  constructor(public client: Client4) {}

  private channelCache = new Map<string, ServerChannel>();
  async getChannelCached(channelId: string): Promise<ServerChannel> {
    let channel = this.channelCache.get(channelId);
    if (channel) {
      return channel;
    }
    channel = await this.client.getChannel(channelId);
    this.channelCache.set(channelId, channel!);
    return channel!;
  }

  private teamCache = new Map<string, Team>();
  async getTeamCached(teamId: string): Promise<Team> {
    let team = this.teamCache.get(teamId);
    if (team) {
      return team;
    }
    team = await this.client.getTeam(teamId);
    this.teamCache.set(teamId, team!);
    return team!;
  }

  private userCache = new Map<string, UserProfile>();
  async getUserCached(userId: string): Promise<UserProfile> {
    let user = this.userCache.get(userId);
    if (user) {
      return user;
    }
    user = await this.client.getUser(userId);
    this.userCache.set(userId, user!);
    return user!;
  }
}

export async function savedPostsQueryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  let config = await getConfig();
  let client = new Client4();
  let cachingClient = new CachingClient4(client);
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
  let resultSavedPosts = [];
  savedPosts = applyQuery(query, savedPosts);
  for (let savedPost of savedPosts) {
    let channel = await cachingClient.getChannelCached(savedPost.channel_id);
    let teamName = config.defaultTeam;
    if (channel.team_id) {
      let team = await cachingClient.getTeamCached(channel.team_id);
      teamName = team.name;
    }
    resultSavedPosts.push({
      ...savedPost,
      user: await cachingClient.getUserCached(savedPost.user_id),
      channel: channel,
      teamName: teamName,
      url: mattermostDesktopUrlForPost(client.url, teamName, savedPost.id),
    });
  }
  return resultSavedPosts;
}
