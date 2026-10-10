/**
 * Hand the browser a file the page built in memory.
 *
 * Object URLs leak the blob for the lifetime of the document unless they are
 * revoked, which is the step that is easy to forget when this is written inline
 * at each call site.
 */
export function downloadFile(
  data: BlobPart,
  fileName: string,
  mimeType: string,
): void {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(value: unknown, fileName: string): void {
  downloadFile(JSON.stringify(value, null, 2), fileName, "application/json");
}
