import { execFile } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { getFreePort } from "../fixtures/core.ts";

const execute = promisify(execFile);
const hosts = [
  "login.sb.test",
  "notes.test",
  "research.test",
  "identity.test",
  "space.sb.test",
];

export type OidcEnvironment = {
  centralOrigin: string;
  notesOrigin: string;
  researchOrigin: string;
  issuerOrigin: string;
  artifactDirectory: string;
  certificatePath: string;
  outboundProxy: string;
  browserArgs: string[];
  stop(): Promise<void>;
};

export async function startOidcEnvironment(
  options: { corePort?: number } = {},
): Promise<OidcEnvironment> {
  const directory = await mkdtemp(join(tmpdir(), "sb-oidc-"));
  const project = `sb-oidc-${randomBytes(6).toString("hex")}`;
  const artifactDirectory = resolve("test-results/oidc-environments", project);
  await mkdir(artifactDirectory, { recursive: true });
  const port = await getFreePort();
  const providerPort = await getFreePort();
  const origin = (host: string) => `https://${host}:${port}`;
  const certificatePath = join(directory, "ca.crt");
  const env = {
    ...process.env,
    OIDC_ISSUER_ORIGIN: origin("identity.test"),
    OIDC_PROVIDER_PORT: String(providerPort),
    OIDC_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
  const compose = (...args: string[]) =>
    execute(
      "docker",
      [
        "compose",
        "-f",
        join(import.meta.dirname, "compose.yaml"),
        "-p",
        project,
        ...args,
      ],
      { env, timeout: 180_000 },
    );
  let server: https.Server | undefined;
  let proxy: http.Server | undefined;
  const sockets = new Set<net.Socket>();
  const trackSocket = (socket: net.Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      process.off("SIGINT", interrupted);
      process.off("SIGTERM", interrupted);
      const logs = await compose("logs", "--no-color").catch((error) => ({
        stdout: String(error),
      }));
      try {
        await mkdir(artifactDirectory, { recursive: true });
        await writeFile(join(artifactDirectory, "provider.log"), logs.stdout);
      } finally {
        for (const socket of sockets) socket.destroy();
        await Promise.all(
          [server, proxy].filter(Boolean).map(
            (listener) =>
              new Promise<void>((done) => {
                listener!.closeAllConnections();
                listener!.close(() => done());
              }),
          ),
        );
        await compose("down", "--volumes", "--remove-orphans");
        await rm(directory, { recursive: true, force: true });
      }
    })();
    return stopping;
  };
  const interrupted = () => {
    void stop().finally(() => process.exit(130));
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    await execute("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 15_000,
    });
    await execute("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "ca.key"),
      "-out",
      certificatePath,
      "-days",
      "2",
      "-subj",
      "/CN=SilverBullet disposable OIDC fixture CA",
    ]);
    await writeFile(
      join(directory, "extensions.cnf"),
      `subjectAltName=${hosts.map((host) => `DNS:${host}`).join(",")}\nextendedKeyUsage=serverAuth\n`,
    );
    await execute("openssl", [
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "server.key"),
      "-out",
      join(directory, "server.csr"),
      "-subj",
      "/CN=SilverBullet disposable fixture",
    ]);
    await execute("openssl", [
      "x509",
      "-req",
      "-in",
      join(directory, "server.csr"),
      "-CA",
      certificatePath,
      "-CAkey",
      join(directory, "ca.key"),
      "-CAcreateserial",
      "-out",
      join(directory, "server.crt"),
      "-days",
      "2",
      "-extfile",
      join(directory, "extensions.cnf"),
    ]);
    const certificate = await readFile(join(directory, "server.crt"));
    const spki = createHash("sha256")
      .update(
        new X509Certificate(certificate).publicKey.export({
          type: "spki",
          format: "der",
        }),
      )
      .digest("base64");
    server = https.createServer(
      { key: await readFile(join(directory, "server.key")), cert: certificate },
      (request, response) => {
        const host = request.headers.host?.split(":")[0];
        if (!hosts.includes(host ?? "")) {
          response.writeHead(421).end();
          return;
        }
        if (host === "identity.test" || options.corePort) {
          const upstream = http.request(
            {
              hostname: "127.0.0.1",
              port: host === "identity.test" ? providerPort : options.corePort,
              path: request.url,
              method: request.method,
              headers: { ...request.headers, "x-forwarded-proto": "https" },
            },
            (incoming) => {
              response.writeHead(incoming.statusCode ?? 502, incoming.headers);
              incoming.pipe(response);
            },
          );
          upstream.on("error", () => response.writeHead(502).end());
          request.pipe(upstream);
          return;
        }
        response.writeHead(404).end();
      },
    );
    server.on("connection", trackSocket);
    await new Promise<void>((done) => server!.listen(port, "127.0.0.1", done));
    proxy = http.createServer((_request, response) =>
      response.writeHead(405).end(),
    );
    proxy.on("connection", trackSocket);
    proxy.on("connect", (request, client, head) => {
      if (!hosts.some((host) => request.url === `${host}:${port}`)) {
        client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      const upstream = net.connect(port, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      trackSocket(upstream);
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
    });
    await new Promise<void>((done) => proxy!.listen(0, "127.0.0.1", done));
    await compose("up", "-d", "--wait", "--wait-timeout", "60");
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const discovery = await fetch(
          `http://127.0.0.1:${providerPort}/.well-known/openid-configuration`,
        );
        if (
          discovery.ok &&
          (await discovery.json()).issuer === origin("identity.test")
        ) {
          ready = true;
          break;
        }
      } catch {
        /* The provider may still be starting. */
      }
      await new Promise((done) => setTimeout(done, 200));
    }
    if (!ready)
      throw new Error(
        "Pocket ID discovery did not become ready with the configured HTTPS issuer",
      );
    return {
      centralOrigin: origin("login.sb.test"),
      notesOrigin: origin("notes.test"),
      researchOrigin: origin("research.test"),
      issuerOrigin: origin("identity.test"),
      artifactDirectory,
      certificatePath,
      outboundProxy: `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`,
      browserArgs: [
        `--host-resolver-rules=${hosts.map((host) => `MAP ${host} 127.0.0.1`).join(",")}`,
        `--ignore-certificate-errors-spki-list=${spki}`,
        "--no-proxy-server",
      ],
      stop,
    };
  } catch (error) {
    await stop().catch((cleanupError) => {
      console.error("OIDC fixture cleanup failed", cleanupError);
    });
    throw new Error(
      `OIDC fixture failed; check Docker, image resolution, TLS and DNS. Logs: ${artifactDirectory}`,
      { cause: error },
    );
  }
}
