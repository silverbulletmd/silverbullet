import type { Object } from "googleapis-storage";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";

class AuthorizationHeadersCache {
  private static headersCache: Record<string, string> | undefined;
  private static expiresAt: number = 0;

  static async getHeaders(): Promise<Record<string, string>> {
    const creds = Deno.build.os === "windows"
      ? JSON.parse(
        await Deno.readTextFile(
          `${
            Deno.env.get("APPDATA")
          }/gcloud/application_default_credentials.json`,
        ),
      )
      : JSON.parse(
        await Deno.readTextFile(
          `${
            Deno.env.get("HOME")
          }/.config/gcloud/application_default_credentials.json`,
        ),
      );

    const params = new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    });

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!resp.ok) {
      throw new Error(`Token exchange failed: ${await resp.text()}`);
    }
    const { access_token } = await resp.json();
    return { Authorization: `Bearer ${access_token}` };
  }

  static async getHeadersWithCache(): Promise<Record<string, string>> {
    const now = Date.now();
    if (!this.headersCache || now > this.expiresAt) {
      this.headersCache = await this.getHeaders();
      this.expiresAt = now + 30 * 60 * 1000; // 30 minutes
    }
    return this.headersCache;
  }
}

export class GCSSBMetadata {
  public sbCreated: string;
  public sbLastModified: string;

  constructor(sbCreated: number, sbLastModified: number) {
    this.sbCreated = String(sbCreated);
    this.sbLastModified = String(sbLastModified);
  }

  static fromObjectMetadata(obj: Object): GCSSBMetadata {
    // if the either metadata is missing, get the value from the object
    return new GCSSBMetadata(
      Number(obj.metadata?.sbCreated) || Number(obj.timeCreated),
      Number(obj.metadata?.sbLastModified) || Number(obj.updated),
    );
  }
}

export async function deleteFile(
  bucketName: string,
  name: string,
): Promise<void> {
  const baseUrl =
    `https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${
      encodeURIComponent(name)
    }`;
  const response = await fetch(baseUrl, {
    method: "DELETE",
    headers: await AuthorizationHeadersCache.getHeadersWithCache(),
  });
  if (!response.ok) {
    throw new Error(`Failed to delete file: ${response.statusText}`);
  }
}

/** List objects in Bucket in Google Cloud Storage */
export async function listFiles(
  bucketName: string,
  prefix: string,
): Promise<FileMeta[]> {
  const baseUrl =
    `https://storage.googleapis.com/storage/v1/b/${bucketName}/o?prefix=${
      encodeURIComponent(
        prefix,
      )
    }`;
  const response = await fetch(baseUrl, {
    headers: await AuthorizationHeadersCache.getHeadersWithCache(),
  });
  const json = await response.json();
  const items = json.items as Object[] | undefined;
  if (!items) {
    return [];
  }
  return items.map((item) => {
    const relativePath = prefix
      ? item.name!.substring(prefix.length + 1)
      : item.name!;
    const metadata = GCSSBMetadata.fromObjectMetadata(item);
    return {
      name: relativePath,
      size: Number(item.size!),
      created: Number(metadata.sbCreated),
      lastModified: Number(metadata.sbLastModified),
      contentType: item.contentType!,
      perm: "rw",
    } as FileMeta;
  });
}

/** Read object in Google Cloud Storage. */
export async function readFileMetadata(
  bucketName: string,
  name: string,
): Promise<FileMeta> {
  const baseUrl =
    `https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${
      encodeURIComponent(name)
    }`;
  const response = await fetch(`${baseUrl}?alt=json`, {
    headers: await AuthorizationHeadersCache.getHeadersWithCache(),
  });
  const object: Object = await response.json();
  const metadata = GCSSBMetadata.fromObjectMetadata(object);
  return {
    name: name,
    created: Number(metadata.sbCreated),
    lastModified: Number(metadata.sbLastModified),
    contentType: object.contentType!,
    size: Number(object.size!),
    perm: "rw",
  } as FileMeta;
}

/** Read object in Google Cloud Storage. */
export async function readFileData(
  bucketName: string,
  name: string,
): Promise<Uint8Array> {
  const baseUrl =
    `https://storage.googleapis.com/download/storage/v1/b/${bucketName}/o/${
      encodeURIComponent(name)
    }`;
  const response = await fetch(`${baseUrl}?alt=media`, {
    headers: await AuthorizationHeadersCache.getHeadersWithCache(),
  });
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/** Creates or updates an object in Google Cloud Storage. */
export async function uploadFile(
  bucketName: string,
  name: string,
  data: Uint8Array,
  meta?: GCSSBMetadata,
): Promise<Object> {
  const multipartString = `--sb_boundary\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ ...meta, name })}\r\n` +
    `--sb_boundary\r\n` +
    `Content-Type: text/markdown\r\n\r\n` +
    `${new TextDecoder().decode(data)}\r\n` +
    `--sb_boundary--\r\n`;
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=multipart`;

  const response = await fetch(
    url,
    {
      method: "POST",
      headers: {
        ...await AuthorizationHeadersCache.getHeadersWithCache(),
        "Content-Type": "multipart/related; boundary=sb_boundary",
        "Content-Length": `${multipartString.length}`,
      },
      body: multipartString,
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to upload file: ${response.statusText}`);
  }

  const result: Object = await response.json();
  return result;
}
