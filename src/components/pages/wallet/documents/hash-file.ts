/**
 * Browser-side content hashing for Document Sign-Off.
 *
 * The bytes never have to leave the machine — hashing locally is what lets a
 * team bind an approval to a confidential document without uploading it.
 */

export async function sha256HexFromBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256HexFromFile(file: File): Promise<string> {
  return sha256HexFromBytes(await file.arrayBuffer());
}
