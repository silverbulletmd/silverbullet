import { Application } from "../deps.ts";
import { PresenceUpdateResponse } from "./collab.ts";

export class NoOpCollabServer {
  start(): void {
    return;
  }

  updatePresence(
    _clientId: string,
    _currentPage?: string,
    _previousPage?: string,
  ): PresenceUpdateResponse {
    return {};
  }

  cleanup(_timeout: number): void {
    return;
  }

  route(_app: Application): void {
    return;
  }
}
