import { readPage, writePage } from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { invokeFunction } from "@silverbulletmd/plugos-silverbullet-syscall/system";
import { getCurrentPage, getText } from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { cleanMarkdown } from "../markdown/util";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { extractMeta } from "../query/data";

type GhostConfig = {
  url: string;
  adminKey: string;
  postPrefix: string;
  pagePrefix: string;
};

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
    let result = await fetch(
      `${this.url}/ghost/api/v3/admin/posts?order=published_at+DESC`,
      {
        headers: {
          Authorization: `Ghost ${this.token}`,
        },
      }
    );

    return (await result.json()).posts;
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

  publishPost(post: Partial<Post>): Promise<any> {
    return this.publish("posts", post);
  }

  publishPage(post: Partial<Post>): Promise<any> {
    return this.publish("pages", post);
  }

  async publish(what: "pages" | "posts", post: Partial<Post>): Promise<any> {
    let oldPostQueryR = await fetch(
      `${this.url}/ghost/api/v3/admin/${what}/slug/${post.slug}`,
      {
        headers: {
          Authorization: `Ghost ${this.token}`,
          "Content-Type": "application/json",
        },
      }
    );
    let oldPostQuery = await oldPostQueryR.json();
    if (!oldPostQuery[what]) {
      // New!
      if (!post.status) {
        post.status = "draft";
      }
      let result = await fetch(`${this.url}/ghost/api/v3/admin/${what}`, {
        method: "POST",
        headers: {
          Authorization: `Ghost ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [what]: [post],
        }),
      });
      return (await result.json())[what][0];
    } else {
      let oldPost: Post = oldPostQuery[what][0];
      post.updated_at = oldPost.updated_at;
      let result = await fetch(
        `${this.url}/ghost/api/v3/admin/${what}/${oldPost.id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Ghost ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            [what]: [post],
          }),
        }
      );
      return (await result.json())[what][0];
    }
  }
}

function postToMarkdown(post: Post): string {
  let text = mobileDocToMarkdown(post.mobiledoc);
  return `# ${post.title}\n${text}`;
}

const postRegex = /#\s*([^\n]+)\n([^$]+)$/;

async function markdownToPost(text: string): Promise<Partial<Post>> {
  let match = postRegex.exec(text);
  if (match) {
    let [, title, content] = match;
    return {
      title,
      mobiledoc: markdownToMobileDoc(await cleanMarkdown(content)),
    };
  }
  throw Error("Post should stat with a # header");
}

async function getConfig(): Promise<GhostConfig> {
  let { text } = await readPage("ghost-config");
  let parsedContent = await parseMarkdown(text);
  let pageMeta = await extractMeta(parsedContent);
  return pageMeta as GhostConfig;
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
    text = `# ${post.title}\n${text}`;
    await writePage(`${config.postPrefix}/${post.slug}`, text);
  }
}
export async function publishCommand() {
  await invokeFunction(
    "server",
    "publish",
    await getCurrentPage(),
    await getText()
  );
}

export async function publish(name: string, text: string) {
  let config = await getConfig();
  let admin = new GhostAdmin(config.url, config.adminKey);
  await admin.init();
  let post = await markdownToPost(text);
  if (name.startsWith(config.postPrefix)) {
    post.slug = name.substring(config.postPrefix.length + 1);
    await admin.publishPost(post);
    console.log("Done!");
  } else if (name.startsWith(config.pagePrefix)) {
    post.slug = name.substring(config.pagePrefix.length + 1);
    await admin.publishPage(post);
    console.log("Done!");
  } else {
    console.error("Not in either the post or page prefix");
  }
}
