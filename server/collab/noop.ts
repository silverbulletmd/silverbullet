import { SpacePrimitives } from "../../common/spaces/space_primitives.ts";
import { Application } from "../deps.ts";
import { ICollabServer, PresenceUpdateResponse } from "./collab.ts";

export function createCollabServer(
  _spacePrimitives: SpacePrimitives,
): ICollabServer {
  return new NoOpCollabServer();
}

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
