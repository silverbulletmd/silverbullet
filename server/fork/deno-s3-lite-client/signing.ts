import * as errors from "./errors.ts";
import { bin2hex, getScope, makeDateLong, makeDateShort, sha256digestHex } from "./helpers.ts";

const signV4Algorithm = "AWS4-HMAC-SHA256";

/**
 * Generate the Authorization header required to authenticate an S3/AWS request.
 */
export async function signV4(request: {
  headers: Headers;
  method: string;
  path: string;
  accessKey: string;
  secretKey: string;
  region: string;
  date: Date;
}): Promise<string> {
  if (!request.accessKey) {
    throw new errors.AccessKeyRequiredError("accessKey is required for signing");
  }
  if (!request.secretKey) {
    throw new errors.SecretKeyRequiredError("secretKey is required for signing");
  }

  const sha256sum = request.headers.get("x-amz-content-sha256");
  if (sha256sum === null) {
    throw new Error(
      "Internal S3 client error - expected x-amz-content-sha256 header, but it's missing.",
    );
  }

  const signedHeaders = getHeadersToSign(request.headers);
  const canonicalRequest = getCanonicalRequest(
    request.method,
    request.path,
    request.headers,
    signedHeaders,
    sha256sum,
  );
  const stringToSign = await getStringToSign(
    canonicalRequest,
    request.date,
    request.region,
  );
  const signingKey = await getSigningKey(
    request.date,
    request.region,
    request.secretKey,
  );
  const credential = getCredential(
    request.accessKey,
    request.region,
    request.date,
  );
  const signature = bin2hex(await sha256hmac(signingKey, stringToSign))
    .toLowerCase();

  return `${signV4Algorithm} Credential=${credential}, SignedHeaders=${
    signedHeaders.join(";").toLowerCase()
  }, Signature=${signature}`;
}

/**
 * Generate a pre-signed URL
 */
export async function presignV4(request: {
  protocol: "http:" | "https:";
  headers: Headers;
  method: string;
  path: string;
  accessKey: string;
  secretKey: string;
  region: string;
  date: Date;
  expirySeconds: number;
}): Promise<string> {
  if (!request.accessKey) {
    throw new errors.AccessKeyRequiredError("accessKey is required for signing");
  }
  if (!request.secretKey) {
    throw new errors.SecretKeyRequiredError("secretKey is required for signing");
  }
  if (request.expirySeconds < 1) {
    throw new errors.InvalidExpiryError("expirySeconds cannot be less than 1 seconds");
  }
  if (request.expirySeconds > 604800) {
    throw new errors.InvalidExpiryError("expirySeconds cannot be greater than 7 days");
  }
  if (!request.headers.has("Host")) {
    throw new Error("Internal error: host header missing");
  }

  // Information about the future request that we're going to sign:
  const resource = request.path.split("?")[0];
  const queryString = request.path.split("?")[1];
  const iso8601Date = makeDateLong(request.date);
  const signedHeaders = getHeadersToSign(request.headers);
  const credential = getCredential(request.accessKey, request.region, request.date);
  const hashedPayload = "UNSIGNED-PAYLOAD";

  // Build the query string for our new signed URL:
  const newQuery = new URLSearchParams(queryString);
  newQuery.set("X-Amz-Algorithm", signV4Algorithm);
  newQuery.set("X-Amz-Credential", credential);
  newQuery.set("X-Amz-Date", iso8601Date);
  newQuery.set("X-Amz-Expires", request.expirySeconds.toString());
  newQuery.set("X-Amz-SignedHeaders", signedHeaders.join(";").toLowerCase());
  const newPath = resource + "?" + newQuery.toString().replace("+", "%20"); // Signing requires spaces become %20, never +

  const canonicalRequest = getCanonicalRequest(request.method, newPath, request.headers, signedHeaders, hashedPayload);
  const stringToSign = await getStringToSign(canonicalRequest, request.date, request.region);
  const signingKey = await getSigningKey(request.date, request.region, request.secretKey);
  const signature = bin2hex(await sha256hmac(signingKey, stringToSign)).toLowerCase();
  const presignedUrl = `${request.protocol}//${request.headers.get("Host")}${newPath}&X-Amz-Signature=${signature}`;
  return presignedUrl;
}

/**
 * Given the set of HTTP headers that we'll be sending with an S3/AWS request, determine which
 * headers will be signed, and in what order.
 */
function getHeadersToSign(headers: Headers): string[] {
  // Excerpts from @lsegal - https://github.com/aws/aws-sdk-js/issues/659#issuecomment-120477258
  //
  //  User-Agent:
  //
  //      This is ignored from signing because signing this causes problems with generating pre-signed URLs
  //      (that are executed by other agents) or when customers pass requests through proxies, which may
  //      modify the user-agent.
  //
  //  Content-Length:
  //
  //      This is ignored from signing because generating a pre-signed URL should not provide a content-length
  //      constraint, specifically when vending a S3 pre-signed PUT URL. The corollary to this is that when
  //      sending regular requests (non-pre-signed), the signature contains a checksum of the body, which
  //      implicitly validates the payload length (since changing the number of bytes would change the checksum)
  //      and therefore this header is not valuable in the signature.
  //
  //  Content-Type:
  //
  //      Signing this header causes quite a number of problems in browser environments, where browsers
  //      like to modify and normalize the content-type header in different ways. There is more information
  //      on this in https://github.com/aws/aws-sdk-js/issues/244. Avoiding this field simplifies logic
  //      and reduces the possibility of future bugs
  //
  //  Authorization:
  //
  //      Is skipped for obvious reasons

  const ignoredHeaders = [
    "authorization",
    "content-length",
    "content-type",
    "user-agent",
  ];
  const headersToSign = [];
  for (const key of headers.keys()) {
    if (ignoredHeaders.includes(key.toLowerCase())) {
      continue; // Ignore this header
    }
    headersToSign.push(key);
  }
  headersToSign.sort();
  return headersToSign;
}

/**
 * getCanonicalRequest generate a canonical request of style.
 *
 * canonicalRequest =
 *   <HTTPMethod>\n
 *   <CanonicalURI>\n
 *   <CanonicalQueryString>\n
 *   <CanonicalHeaders>\n
 *   <SignedHeaders>\n
 *   <HashedPayload>
 */
function getCanonicalRequest(
  method: string,
  path: string,
  headers: Headers,
  headersToSign: string[],
  payloadHash: string,
): string {
  const headersArray = headersToSign.reduce<string[]>((acc, headerKey) => {
    // Trim spaces from the value (required by V4 spec)
    const val = `${headers.get(headerKey)}`.replace(/ +/g, " ");
    acc.push(`${headerKey.toLowerCase()}:${val}`);
    return acc;
  }, []);

  const requestResource = path.split("?")[0];
  let requestQuery = path.split("?")[1];
  if (requestQuery) {
    requestQuery = requestQuery
      .split("&")
      .sort()
      .map((element) => element.indexOf("=") === -1 ? element + "=" : element)
      .join("&");
  } else {
    requestQuery = "";
  }

  const canonical = [];
  canonical.push(method.toUpperCase());
  canonical.push(requestResource);
  canonical.push(requestQuery);
  canonical.push(headersArray.join("\n") + "\n");
  canonical.push(headersToSign.join(";").toLowerCase());
  canonical.push(payloadHash);
  return canonical.join("\n");
}

// Stolen from https://github.com/aws/aws-sdk-js/blob/master/lib/util.js

export function uriEscapePath(string: string): string {
  return string.split("/").map(uriEscape).join("/");
}

function uriEscape(string: string): string {
  let output = encodeURIComponent(string);
  output = output.replace(/[^A-Za-z0-9_.~\-%]+/g, escape);

  // AWS percent-encodes some extra non-standard characters in a URI
  output = output.replace(/[*]/g, function (ch) {
    return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
  });

  return output;
}
// returns the string that needs to be signed
async function getStringToSign(
  canonicalRequest: string,
  requestDate: Date,
  region: string,
): Promise<string> {
  const hash = await sha256digestHex(canonicalRequest);
  const scope = getScope(region, requestDate);
  const stringToSign = [];
  stringToSign.push(signV4Algorithm);
  stringToSign.push(makeDateLong(requestDate));
  stringToSign.push(scope);
  stringToSign.push(hash);
  return stringToSign.join("\n");
}

/** returns the key used for calculating signature */
async function getSigningKey(
  date: Date,
  region: string,
  secretKey: string,
): Promise<Uint8Array> {
  const dateLine = makeDateShort(date);
  const hmac1 = await sha256hmac("AWS4" + secretKey, dateLine);
  const hmac2 = await sha256hmac(hmac1, region);
  const hmac3 = await sha256hmac(hmac2, "s3");
  return await sha256hmac(hmac3, "aws4_request");
}

/** generate a credential string  */
function getCredential(accessKey: string, region: string, requestDate: Date) {
  return `${accessKey}/${getScope(region, requestDate)}`;
}

/**
 * Given a secret key and some data, generate a HMAC of the data using SHA-256.
 * @param secretKey
 * @param data
 * @returns
 */
async function sha256hmac(
  secretKey: Uint8Array | string,
  data: Uint8Array | string,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyObject = await crypto.subtle.importKey(
    "raw", // raw format of the key - should be Uint8Array
    secretKey instanceof Uint8Array ? secretKey : enc.encode(secretKey),
    { name: "HMAC", hash: { name: "SHA-256" } }, // algorithm
    false, // export = false
    ["sign", "verify"], // what this key can do
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    keyObject,
    data instanceof Uint8Array ? data : enc.encode(data),
  );
  return new Uint8Array(signature);
}

// Export for testing purposes only
export const _internalMethods = {
  getHeadersToSign,
  getCanonicalRequest,
  getStringToSign,
  getSigningKey,
  getCredential,
  sha256hmac,
};
