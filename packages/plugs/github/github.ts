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

  async listPulls(
    repo: string,
    state: string = "all",
    sort: string = "updated"
  ): Promise<any[]> {
    return this.apiCall(
      `https://api.github.com/repos/${repo}/pulls?state=${state}&sort=${sort}&direction=desc&per_page=100`
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

function mapPull(pull: any): any {
  // console.log("Pull", Object.keys(pull));
  return {
    ...pull,
    username: pull.user.login,
    // repo: pull.repo.name,
    createdAt: pull.created_at.split("T")[0],
    updatedAt: pull.updated_at.split("T")[0],
  };
}

export async function queryPulls({
  query,
}: QueryProviderEvent): Promise<any[]> {
  let api = await GithubApi.fromConfig();
  let repo = query.filter.find((f) => f.prop === "repo");
  if (!repo) {
    throw Error("No 'repo' specified, this is mandatory");
  }
  query.filter.splice(query.filter.indexOf(repo), 1);
  let repos: string[] = [];
  if (repo.op === "=") {
    repos = [repo.value];
  } else if (repo.op === "in") {
    repos = repo.value;
  } else {
    throw new Error(`Unsupported operator ${repo.op}`);
  }
  let allPulls: any[] = [];
  for (let pullList of await Promise.all(
    repos.map((repo) => api.listPulls(repo, "all", "updated"))
  )) {
    allPulls.push(...pullList);
  }
  allPulls = applyQuery(query, allPulls.map(mapPull));
  return allPulls;
}
