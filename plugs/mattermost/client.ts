import { readPage } from "plugos-silverbullet-syscall/space";
import { parseMarkdown } from "plugos-silverbullet-syscall/markdown";
import { extractMeta } from "../query/data";
import { json } from "plugos-syscall/fetch";
import type { UserProfile } from "@mattermost/types/lib/users";
import type { Post } from "@mattermost/types/lib/posts";
import type { Channel } from "@mattermost/types/lib/channels";
import type { Team } from "@mattermost/types/lib/teams";
import { niceDate } from "../core/dates";

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

type AugmentedPost = Post & {
  // Dates we can use to filter
  createdAt: string;
  updatedAt: string;
  editedAt: string;
};

export class MattermostClient {
  userCache = new Map<string, UserProfile>();
  channelCache = new Map<string, Channel>();
  teamCache = new Map<string, Team>();

  constructor(readonly url: string, readonly token: string) {}

  static async fromConfig(): Promise<MattermostClient> {
    let config = await getConfig();
    return new MattermostClient(config.url, config.token);
  }

  getMe(): Promise<UserProfile> {
    return this.getUser("me");
  }

  async getUser(userId: string): Promise<UserProfile> {
    let user = this.userCache.get(userId);
    if (user) {
      return user;
    }
    user = await json(`${this.url}/api/v4/users/${userId}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });
    this.userCache.set(userId, user!);
    return user!;
  }

  async getChannel(channelId: string): Promise<Channel> {
    let channel = this.channelCache.get(channelId);
    if (channel) {
      return channel;
    }
    channel = await json(`${this.url}/api/v4/channels/${channelId}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });
    this.channelCache.set(channelId, channel!);
    return channel!;
  }

  async getTeam(teamId: string): Promise<Team> {
    let team = this.teamCache.get(teamId);
    if (team) {
      return team;
    }
    team = await json(`${this.url}/api/v4/teams/${teamId}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });
    this.teamCache.set(teamId, team!);
    return team!;
  }

  async getFlaggedPosts(
    userId: string,
    perPage: number = 10
  ): Promise<AugmentedPost[]> {
    let postCollection = await json(
      `${this.url}/api/v4/users/${userId}/posts/flagged?per_page=${perPage}`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      }
    );
    let posts: AugmentedPost[] = [];
    for (let order of postCollection.order) {
      let post = postCollection.posts[order];
      augmentPost(post);
      posts.push(post);
    }
    return posts;
  }
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
