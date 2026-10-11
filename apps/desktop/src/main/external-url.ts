/** Only web URLs can cross Electron's privileged shell.openExternal boundary. */
export function requireSafeExternalUrl(input: unknown): string {
  if (typeof input !== "string" || input.length > 2048)
    throw new Error(
      "UNSAFE_EXTERNAL_URL: Expected a web URL under 2049 characters.",
    );
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("UNSAFE_EXTERNAL_URL: URL is invalid.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "UNSAFE_EXTERNAL_URL: Only http(s) URLs without credentials are permitted.",
    );
  return url.href;
}
