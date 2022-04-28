import { applyQuery, QueryProviderEvent, renderQuery } from "../query/engine";
import { jsonToMDTable } from "../query/util";

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

async function listEvents(username: string): Promise<GithubEvent[]> {
  let events = await fetch(`https://api.github.com/users/${username}/events`);
  return await events.json();
}

async function listIssues(filter: string): Promise<any[]> {
  let issues = await fetch(
    `https://api.github.com/issues?q=${encodeURIComponent(filter)}`
  );
  return await issues.json();
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
  let usernameFilter = query.filter.find((f) => f.prop === "username");
  if (!usernameFilter) {
    throw Error("No 'username' filter specified, this is mandatory");
  }
  let username = usernameFilter.value;
  let allEvents = (await listEvents(username)).map(mapEvent);
  return applyQuery(query, allEvents);
}

// export async function queryIssues({
//   query,
// }: QueryProviderEvent): Promise<string> {
//   let filter = query.filter.find((f) => f.prop === "filter");
//   if (!filter) {
//     throw Error("No 'filter' specified, this is mandatory");
//   }
//   let username = filter.value;
// }
