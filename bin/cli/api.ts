import { decrypt, type SpaceConfig } from "./config.ts";

type APIResponse = {
  result?: any;
  error?: string;
};

export type ConsoleLogEntry = {
  level: string;
  text: string;
  timestamp: number;
};

export class SpaceConnection {
  private baseUrl: string;
  private token?: string;
  private spaceConfig?: SpaceConfig;
  private cachedJwt?: string;
  private authCookieName?: string;
  timeout: number;

  constructor(opts: {
    space?: SpaceConfig;
    url?: string;
    token?: string;
    timeout?: number;
  }) {
    if (opts.url) {
      this.baseUrl = opts.url.replace(/\/$/, "");
    } else if (opts.space) {
      this.baseUrl = opts.space.url.replace(/\/$/, "");
    } else {
      throw new Error("No URL or space configured");
    }
    this.token = opts.token;
    this.spaceConfig = opts.space;
    this.timeout = opts.timeout ?? 30;
  }

  private async buildHeaders(): Promise<Headers> {
    const headers = new Headers();

    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    } else if (this.spaceConfig) {
      const space = this.spaceConfig;
      if (space.authType === "token" && space.encryptedToken) {
        const token = decrypt(space.encryptedToken);
        headers.set("Authorization", `Bearer ${token}`);
      } else if (space.authType === "password" && space.username) {
        const jwt = await this.loginForJwt();
        headers.set("Cookie", `${this.authCookieName}=${jwt}`);
      }
    }

    return headers;
  }

  private async loginForJwt(): Promise<string> {
    if (this.cachedJwt) return this.cachedJwt;

    const space = this.spaceConfig!;
    const password = decrypt(space.encryptedPassword!);

    const res = await fetch(`${this.baseUrl}/.auth`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: space.username!, password }),
      redirect: "manual",
    });

    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) {
      throw new Error(
        `Login failed (status ${res.status}): no auth cookie returned`,
      );
    }

    const match = setCookie.match(/(auth_[^=]+)=([^;]+)/);
    if (!match) {
      throw new Error("Login failed: could not extract auth token from cookie");
    }

    this.authCookieName = match[1];
    this.cachedJwt = match[2];
    return this.cachedJwt;
  }

  private async apiRequest(endpoint: string, body: string): Promise<any> {
    const headers = await this.buildHeaders();
    headers.set("Content-Type", "text/plain");

    const controller = new AbortController();
    const timeoutMs = this.timeout * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
        redirect: "manual",
      });

      if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
        throw new Error(
          "Authentication required. Use --token, or configure a space with 'silverbullet-cli space add'.",
        );
      }

      if (!res.ok) {
        // Try to parse JSON error, fall back to status text
        const text = await res.text();
        try {
          const data: APIResponse = JSON.parse(text);
          if (data.error) {
            throw new Error(data.error);
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error(
              `Server returned ${res.status}: ${text || res.statusText}`,
            );
          }
          throw e;
        }
      }

      const data: APIResponse = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  private async apiGet(
    endpoint: string,
    params?: Record<string, string>,
  ): Promise<Response> {
    const headers = await this.buildHeaders();

    const controller = new AbortController();
    const timeoutMs = this.timeout * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "manual",
      });

      if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
        throw new Error(
          "Authentication required. Use --token, or configure a space with 'silverbullet-cli space add'.",
        );
      }

      if (!res.ok) {
        const text = await res.text();
        try {
          const data: APIResponse = JSON.parse(text);
          if (data.error) {
            throw new Error(data.error);
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error(
              `Server returned ${res.status}: ${text || res.statusText}`,
            );
          }
          throw e;
        }
      }

      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async screenshot(): Promise<Buffer> {
    const res = await this.apiGet("/.runtime/screenshot");
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  async logs(
    limit?: number,
    since?: number,
  ): Promise<ConsoleLogEntry[]> {
    const params: Record<string, string> = {};
    if (limit !== undefined) {
      params.limit = String(limit);
    }
    if (since !== undefined) {
      params.since = String(since);
    }
    const res = await this.apiGet("/.runtime/logs", params);
    const data = await res.json();
    return data.logs;
  }

  evalLua(expression: string): Promise<any> {
    return this.apiRequest("/.runtime/lua", expression);
  }

  evalLuaScript(script: string): Promise<any> {
    return this.apiRequest("/.runtime/lua_script", script);
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/.ping`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
