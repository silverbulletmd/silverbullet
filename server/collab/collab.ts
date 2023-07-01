import { Application } from "../deps.ts";

export interface PresenceUpdateResponse {
  collabId?: string;
}

export interface ICollabServer {
  start(): void;

  updatePresence(
    clientId: string,
    currentPage?: string,
    previousPage?: string,
  ): PresenceUpdateResponse;

  cleanup(timeout: number): void;

  route(app: Application): void;
}
