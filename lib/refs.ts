// Validation for reference image URLs forwarded to kie.ai.
//
// The room generation steps can pass the previously generated overview image as
// an extra reference. To avoid forwarding arbitrary attacker-supplied URLs to
// kie.ai (an SSRF-style passthrough), only allow https URLs on the hosts kie.ai
// actually serves uploaded/generated files from.

const ALLOWED_HOST_SUFFIXES = [
  "redpandaai.co", // base64 upload (kieai.redpandaai.co) + temp files (tempfile.redpandaai.co)
  "aiquickdraw.com", // generated result URLs (static.aiquickdraw.com)
  "kie.ai",
];

/** True if `url` is an https URL on a known kie.ai-associated host. */
export function isAllowedReference(url: unknown): url is string {
  if (typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}
