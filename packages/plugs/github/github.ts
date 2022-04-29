import { applyQuery, QueryProviderEvent, renderQuery } from "../query/engine";
import { readPage } from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { extractMeta } from "../query/data";

type GithubEvent = {
  id: string;
  type: string;
  actor: GithubUser;
  repo: GithubRepo;
  created_at: string;
  payload: any;
  org: GithubOrg;
};

type GithubUser = {
  id: number;
  login: string;
  display_login: string;
  url: string;
};

type GithubRepo = {
  id: number;
  name: string;
  url: string;
};

type GithubOrg = {
  id: number;
  login: string;
  url: string;
};

type ExposedEvent = {
  id: string;
  type: string;
  username: string;
  repo: string;
};

class GithubApi {
  constructor(private token?: string) {}

  async apiCall(url: string, options: any = {}): Promise<any> {
    let res = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.token ? `token ${this.token}` : undefined,
      },
    });
    if (res.status !== 200) {
      throw new Error(await res.text());
    }
    return res.json();
  }

  async listEvents(username: string): Promise<GithubEvent[]> {
    return this.apiCall(
      `https://api.github.com/users/${username}/events?per_page=100`
    );
  }

  async listIssues(filter: string): Promise<any[]> {
    return this.apiCall(
      `https://api.github.com/issues?q=${encodeURIComponent(filter)}`
    );
  }

  static async fromConfig(): Promise<GithubApi> {
    return new GithubApi((await getConfig()).token);
  }
}

type GithubConfig = {
  token?: string;
};

async function getConfig(): Promise<GithubConfig> {
  try {
    let { text } = await readPage("github-config");
    let parsedContent = await parseMarkdown(text);
    let pageMeta = await extractMeta(parsedContent);
    return pageMeta as GithubConfig;
  } catch (e) {
    console.error("No github-config page found, using default config");
    return {};
  }
}

function mapEvent(event: GithubEvent): any {
  // console.log("Event", event);
  return {
    ...event.payload,
    id: event.id,
    type: event.type,
    username: event.actor.login,
    repo: event.repo.name,
    date: event.created_at.split("T")[0],
  };
}

export async function queryEvents({
  query,
}: QueryProviderEvent): Promise<any[]> {
  let api = await GithubApi.fromConfig();
  let usernameFilter = query.filter.find((f) => f.prop === "username");
  if (!usernameFilter) {
    throw Error("No 'username' filter specified, this is mandatory");
  }
  let usernames: string[] = [];
  if (usernameFilter.op === "=") {
    usernames = [usernameFilter.value];
  } else if (usernameFilter.op === "in") {
    usernames = usernameFilter.value;
  } else {
    throw new Error(`Unsupported operator ${usernameFilter.op}`);
  }
  let allEvents: GithubEvent[] = [];
  for (let eventList of await Promise.all(
    usernames.map((username) => api.listEvents(username))
  )) {
    allEvents.push(...eventList);
  }
  // console.log("Usernames", usernames, "Event list lenght", allEvents[0]);
  return applyQuery(query, allEvents.map(mapEvent));
}

export async function queryIssues({
  query,
}: QueryProviderEvent): Promise<any[]> {
  let api = await GithubApi.fromConfig();
  let filter = query.filter.find((f) => f.prop === "filter");
  if (!filter) {
    throw Error("No 'filter' specified, this is mandatory");
  }
  let queries: string[] = [];
  if (filter.op === "=") {
    queries = [filter.value];
  } else if (filter.op === "in") {
    queries = filter.value;
  } else {
    throw new Error(`Unsupported operator ${filter.op}`);
  }
  let allIssues: any[] = [];
  for (let issuesList of await Promise.all(
    queries.map((query) => api.listIssues(query))
  )) {
    allIssues.push(...issuesList);
  }
  return allIssues;
}
