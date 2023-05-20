import type { Client, ObjectMetadata, UploadedObjectInfo } from "./client.ts";
import { getVersionId, sanitizeETag } from "./helpers.ts";
import { parse as parseXML } from "./xml-parser.ts";

/**
 * Stream a file to S3
 *
 * We assume that TransformChunkSizes has been used first, so that this stream
 * will always receive chunks of exactly size "partSize", except for the final
 * chunk.
 *
 * Note that the total size of the upload doesn't have to be known in advance,
 * as long as TransformChunkSizes was used first. Then this ObjectUploader
 * will decide based on the size of the first chunk whether it is doing a
 * single-request upload or a multi-part upload.
 */
export class ObjectUploader extends WritableStream<Uint8Array> {
  public readonly getResult: () => UploadedObjectInfo;

  constructor({ client, bucketName, objectName, partSize, metadata }: {
    client: Client;
    bucketName: string;
    objectName: string;
    partSize: number;
    metadata: Record<string, string>;
  }) {
    let result: UploadedObjectInfo;
    let nextPartNumber = 1;
    let uploadId: string;
    const etags: { part: number; etag: string }[] = [];
    const partsPromises: Promise<Response>[] = []; // If doing multi-part upload, this holds a promise for each part so we can upload them in parallel

    super({
      start() {}, // required
      async write(chunk, _controller) {
        const method = "PUT";
        const partNumber = nextPartNumber++;

        try {
          // We are going to upload this file in a single part, because it's small enough
          if (partNumber == 1 && chunk.length < partSize) {
            // PUT the chunk in a single request — use an empty query.
            const response = await client.makeRequest({
              method,
              headers: new Headers({
                // Set user metadata as this is not a multipart upload
                ...metadata,
                "Content-Length": String(chunk.length),
              }),
              bucketName,
              objectName,
              payload: chunk,
            });
            result = {
              etag: sanitizeETag(response.headers.get("etag") ?? undefined),
              versionId: getVersionId(response.headers),
            };
            return;
          }

          /// If we get here, this is a streaming upload in multiple parts.
          if (partNumber === 1) {
            uploadId = (await initiateNewMultipartUpload({
              client,
              bucketName,
              objectName,
              metadata,
            })).uploadId;
          }
          // Upload the next part
          const partPromise = client.makeRequest({
            method,
            query: { partNumber: partNumber.toString(), uploadId },
            headers: new Headers({ "Content-Length": String(chunk.length) }),
            bucketName: bucketName,
            objectName: objectName,
            payload: chunk,
          });
          partPromise.then((response) => {
            // In order to aggregate the parts together, we need to collect the etags.
            let etag = response.headers.get("etag") ?? "";
            if (etag) {
              etag = etag.replace(/^"/, "").replace(/"$/, "");
            }
            etags.push({ part: partNumber, etag });
          });
          partsPromises.push(partPromise);
        } catch (err) {
          // Throwing an error will make future writes to this sink fail.
          throw err;
        }
      },
      async close() {
        if (result) {
          // This was already completed, in a single upload. Nothing more to do.
        } else if (uploadId) {
          // Wait for all parts to finish uploading
          await Promise.all(partsPromises);
          // Sort the etags (required)
          etags.sort((a, b) => a.part > b.part ? 1 : -1);
          // Complete the multi-part upload
          result = await completeMultipartUpload({ client, bucketName, objectName, uploadId, etags });
        } else {
          throw new Error("Stream was closed without uploading any data.");
        }
      },
    });
    this.getResult = () => {
      if (result === undefined) {
        throw new Error("Result is not ready. await the stream first.");
      }
      return result;
    };
  }
}

/** Initiate a new multipart upload request. */
async function initiateNewMultipartUpload(
  options: {
    client: Client;
    bucketName: string;
    objectName: string;
    metadata?: ObjectMetadata;
  },
): Promise<{ uploadId: string }> {
  const method = "POST";
  const headers = new Headers(options.metadata);
  const query = "uploads";
  const response = await options.client.makeRequest({
    method,
    bucketName: options.bucketName,
    objectName: options.objectName,
    query,
    headers,
    returnBody: true,
  });
  // Response is like:
  // <InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  //   <Bucket>dev-bucket</Bucket>
  //   <Key>test-32m.dat</Key>
  //   <UploadId>422f976b-35e0-4a55-aca7-bf2d46277f93</UploadId>
  // </InitiateMultipartUploadResult>
  const responseText = await response.text();
  const root = parseXML(responseText).root;
  if (!root || root.name !== "InitiateMultipartUploadResult") {
    throw new Error(`Unexpected response: ${responseText}`);
  }
  const uploadId = root.children.find((c) => c.name === "UploadId")?.content;
  if (!uploadId) {
    throw new Error(`Unable to get UploadId from response: ${responseText}`);
  }
  return { uploadId };
}

async function completeMultipartUpload(
  { client, bucketName, objectName, uploadId, etags }: {
    client: Client;
    bucketName: string;
    objectName: string;
    uploadId: string;
    etags: { part: number; etag: string }[];
  },
): Promise<UploadedObjectInfo> {
  const payload = `
    <CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        ${etags.map((et) => `  <Part><PartNumber>${et.part}</PartNumber><ETag>${et.etag}</ETag></Part>`).join("\n")}
    </CompleteMultipartUpload>
  `;
  const response = await client.makeRequest({
    method: "POST",
    bucketName,
    objectName,
    query: `uploadId=${encodeURIComponent(uploadId)}`,
    payload: new TextEncoder().encode(payload),
    returnBody: true,
  });
  const responseText = await response.text();
  // Example response:
  // <?xml version="1.0" encoding="UTF-8"?>
  // <CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  //   <Location>http://localhost:9000/dev-bucket/test-32m.dat</Location>
  //   <Bucket>dev-bucket</Bucket>
  //   <Key>test-32m.dat</Key>
  //   <ETag>&#34;4581589392ae60eafdb031f441858c7a-7&#34;</ETag>
  // </CompleteMultipartUploadResult>
  const root = parseXML(responseText).root;
  if (!root || root.name !== "CompleteMultipartUploadResult") {
    throw new Error(`Unexpected response: ${responseText}`);
  }
  const etagRaw = root.children.find((c) => c.name === "ETag")?.content;
  if (!etagRaw) throw new Error(`Unable to get ETag from response: ${responseText}`);
  const versionId = getVersionId(response.headers);
  return {
    etag: sanitizeETag(etagRaw),
    versionId,
  };
}
