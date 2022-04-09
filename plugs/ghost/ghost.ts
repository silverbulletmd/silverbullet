import { readPage, writePage } from "plugos-silverbullet-syscall/space";
import { json } from "plugos-syscall/fetch";
import YAML from "yaml";
import { invokeFunction } from "plugos-silverbullet-syscall/system";
import { getCurrentPage, getText } from "plugos-silverbullet-syscall/editor";
import { cleanMarkdown } from "../markdown/markdown";

type Post = {
  id: string;
  uuid: string;
  title: string;
  slug: string;
  mobiledoc: string;
  status: "draft" | "published";
  visibility: string;
  created_at: string;
  upblished_at: string;
  updated_at: string;
  tags: Tag[];
  primary_tag: Tag;
  url: string;
  excerpt: string;
};

type Tag = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

type MobileDoc = {
  version: string;
  atoms: any[];
  cards: Card[];
};

type Card = any[];

function mobileDocToMarkdown(doc: string): string | null {
  let mobileDoc = JSON.parse(doc) as MobileDoc;
  if (mobileDoc.cards.length > 0 && mobileDoc.cards[0][0] === "markdown") {
    return mobileDoc.cards[0][1].markdown;
  }
  return null;
}

function markdownToMobileDoc(text: string): string {
  return JSON.stringify({
    version: "0.3.1",
    atoms: [],
    cards: [["markdown", { markdown: text }]],
    markups: [],
    sections: [
      [10, 0],
      [1, "p", []],
    ],
  });
}

class GhostAdmin {
  private token?: string;

  constructor(private url: string, private key: string) {}

  async init() {
    const [id, secret] = this.key.split(":");

    this.token = await self.syscall(
      "jwt.jwt",
      secret,
      id,
      "HS256",
      "5m",
      "/v3/admin/"
    );
  }

  async listPosts(): Promise<Post[]> {
    let result = await json(
      `${this.url}/ghost/api/v3/admin/posts?order=published_at+DESC`,
      {
        headers: {
          Authorization: `Ghost ${this.token}`,
        },
      }
    );

    return result.posts;
  }

  async listMarkdownPosts(): Promise<Post[]> {
    let markdownPosts: Post[] = [];
    for (let post of await this.listPosts()) {
      let mobileDoc = JSON.parse(post.mobiledoc) as MobileDoc;
      if (mobileDoc.cards.length > 0 && mobileDoc.cards[0][0] === "markdown") {
        markdownPosts.push(post);
      }
    }
    return markdownPosts;
  }

  async createPost(post: Partial<Post>): Promise<Post> {
    let result = await json(`${this.url}/ghost/api/v3/admin/posts`, {
      method: "POST",
      headers: {
        Authorization: `Ghost ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        posts: [post],
      }),
    });
    return result.posts[0];
  }

  async updatePost(post: Partial<Post>): Promise<any> {
    let oldPost = await json(
      `${this.url}/ghost/api/v3/admin/posts/${post.id}`,
      {
        headers: {
          Authorization: `Ghost ${this.token}`,
          "Content-Type": "application/json",
        },
      }
    );
    post.updated_at = oldPost.posts[0].updated_at;
    let result = await json(`${this.url}/ghost/api/v3/admin/posts/${post.id}`, {
      method: "PUT",
      headers: {
        Authorization: `Ghost ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        posts: [post],
      }),
    });
    return result.posts[0];
  }
}

type GhostConfig = {
  url: string;
  adminKey: string;
  pagePrefix: string;
};

function postToMarkdown(post: Post): string {
  let text = mobileDocToMarkdown(post.mobiledoc);
  return `<!-- #ghost-id: ${post.id} -->\n# ${post.title}\n${text}`;
}

const publishedPostRegex =
  /<!-- #ghost-id:\s*(\w+)\s*-->\n#\s*([^\n]+)\n([^$]+)$/;
const newPostRegex = /#\s*([^\n]+)\n([^$]+)$/;

async function markdownToPost(text: string): Promise<Partial<Post>> {
  let match = publishedPostRegex.exec(text);
  if (match) {
    let [, id, title, content] = match;
    return {
      id,
      title,
      mobiledoc: markdownToMobileDoc(await cleanMarkdown(content)),
    };
  }
  match = newPostRegex.exec(text);
  if (match) {
    let [, title, content] = match;
    return {
      title,
      status: "draft",
      mobiledoc: markdownToMobileDoc(await cleanMarkdown(content)),
    };
  }
  throw Error("Not a valid ghost post");
}

async function getConfig(): Promise<GhostConfig> {
  let configPage = await readPage("ghost-config");
  return YAML.parse(configPage.text) as GhostConfig;
}

export async function downloadAllPostsCommand() {
  await invokeFunction("server", "downloadAllPosts");
}
export async function downloadAllPosts() {
  let config = await getConfig();
  let admin = new GhostAdmin(config.url, config.adminKey);
  await admin.init();
  let allPosts = await admin.listMarkdownPosts();
  for (let post of allPosts) {
    let text = mobileDocToMarkdown(post.mobiledoc);
    text = `<!-- #ghost-id: ${post.id} -->\n# ${post.title}\n${text}`;
    await writePage(`${config.pagePrefix}${post.slug}`, text);
  }
}
export async function publishPostCommand() {
  await invokeFunction(
    "server",
    "publishPost",
    await getCurrentPage(),
    await getText()
  );
}

export async function publishPost(name: string, text: string) {
  let config = await getConfig();
  let admin = new GhostAdmin(config.url, config.adminKey);
  await admin.init();
  let post = await markdownToPost(text);
  post.slug = name.substring(config.pagePrefix.length);
  if (post.id) {
    await admin.updatePost(post);
  } else {
    let newPost = await admin.createPost(post);
    text = `<!-- #ghost-id: ${newPost.id} -->\n${text}`;
    await writePage(name, text);
  }
}
