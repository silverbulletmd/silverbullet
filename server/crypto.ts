export async function hashSHA256(message: string): Promise<string> {
  // Transform the string into an ArrayBuffer
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  // Generate the hash
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);

  // Transform the hash into a hex string
  return Array.from(new Uint8Array(hashBuffer)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}
