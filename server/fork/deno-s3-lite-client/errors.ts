import { parse as parseXML } from "./xml-parser.ts";

/**
 * Base class for all errors raised by this S3 client.
 */
export class DenoS3LiteClientError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * An argument or configuration parameter was invalid.
 */
export class InvalidArgumentError extends DenoS3LiteClientError {}

/**
 * InvalidEndpointError is generated when an invalid end point value is
 * provided which does not follow domain standards.
 */
export class InvalidEndpointError extends DenoS3LiteClientError {}

/**
 * InvalidBucketNameError is generated when an invalid bucket name is
 * provided which does not follow AWS S3 specifications.
 * http://docs.aws.amazon.com/AmazonS3/latest/dev/BucketRestrictions.html
 */
export class InvalidBucketNameError extends DenoS3LiteClientError {}

/**
 * InvalidObjectNameError is generated when an invalid object name is
 * provided which does not follow AWS S3 specifications.
 * http://docs.aws.amazon.com/AmazonS3/latest/dev/UsingMetadata.html
 */
export class InvalidObjectNameError extends DenoS3LiteClientError {}

/** The request cannot be made without an access key to authenticate it */
export class AccessKeyRequiredError extends DenoS3LiteClientError {}

/** The request cannot be made without a secret key to authenticate it */
export class SecretKeyRequiredError extends DenoS3LiteClientError {}

/** The expiration time for the request is invalid */
export class InvalidExpiryError extends DenoS3LiteClientError {}

/** Any error thrown by the server */
export class ServerError extends DenoS3LiteClientError {
  readonly statusCode: number;
  readonly code: string;
  readonly key: string | undefined;
  readonly bucketName: string | undefined;
  readonly resource: string | undefined;
  readonly region: string | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    otherData: { key?: string; bucketName?: string; resource?: string; region?: string } = {},
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.key = otherData.key;
    this.bucketName = otherData.bucketName;
    this.resource = otherData.resource;
    this.region = otherData.region;
  }
}

export async function parseServerError(response: Response): Promise<ServerError> {
  try {
    const xmlParsed = parseXML(await response.text());
    const errorRoot = xmlParsed.root;
    if (errorRoot?.name !== "Error") {
      throw new Error("Invalid root, expected <Error>");
    }
    const code = errorRoot.children.find((c) => c.name === "Code")?.content ?? "UnknownErrorCode";
    const message = errorRoot.children.find((c) => c.name === "Message")?.content ??
      "The error message could not be determined.";
    const key = errorRoot.children.find((c) => c.name === "Key")?.content;
    const bucketName = errorRoot.children.find((c) => c.name === "BucketName")?.content;
    const resource = errorRoot.children.find((c) => c.name === "Resource")?.content; // e.g. the object key
    const region = errorRoot.children.find((c) => c.name === "Region")?.content;
    return new ServerError(response.status, code, message, { key, bucketName, resource, region });
  } catch {
    return new ServerError(
      response.status,
      "UnrecognizedError",
      `Error: Unexpected response code ${response.status} ${response.statusText}. Unable to parse response as XML.`,
    );
  }
}
