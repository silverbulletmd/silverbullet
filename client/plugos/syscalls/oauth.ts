import type { Client } from "../../client.ts";
import {
  DeviceFlowError,
  type DeviceFlowOptions,
  runDeviceFlow,
} from "../../auth/device_flow.ts";
import { sleep } from "../../../plug-api/lib/async.ts";
import { proxyFetch } from "../../space_lua/stdlib/net.ts";
import type { SysCallMapping } from "../system.ts";

export function oauthSyscalls(client: Client): SysCallMapping {
  return {
    "oauth.deviceFlow": {
      callback: async (_ctx, opts: DeviceFlowOptions) => {
        try {
          return await runDeviceFlow(
            {
              ...opts,
              deviceName:
                opts.deviceName ?? `SilverBullet (${globalThis.location.host})`,
            },
            {
              fetch: proxyFetch,
              sleep,
              now: Date.now,
              showCode: (code, cancel) =>
                client.ui.showDeviceCode(code, cancel),
            },
          );
        } catch (e: any) {
          // Space Lua errors are strings, so the reason is a message prefix
          if (e instanceof DeviceFlowError) {
            throw new Error(`${e.reason}: ${e.message}`);
          }
          throw new Error(`failed: ${e?.message ?? e}`);
        }
      },
      description:
        "Runs an OAuth 2.0 device authorization flow (RFC 8628). Shows a modal with a code for the user to enter, polls until approved, and returns the raw token response. Errors start with one of `cancelled:`, `expired:`, `denied:` or `failed:`.",
      parameters: [
        {
          name: "opts",
          type: "table",
          description:
            "Table with `deviceCodeUrl`, `tokenUrl`, `clientId`, and optionally `scope` and `deviceName`.",
        },
      ],
      returns: [{ description: "The token response as a table." }],
      examples: [
        {
          code: 'local token = oauth.deviceFlow {\n  deviceCodeUrl = "https://github.com/login/device/code",\n  tokenUrl = "https://github.com/login/oauth/access_token",\n  clientId = "my-client-id",\n  scope = "repo gist",\n}',
        },
      ],
    },
  };
}
