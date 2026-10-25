/** Replace exact credential strings. Longer values win so a prefix does not leave a tail. */
export function scrubKnownSecrets(input: string, secrets: readonly string[]): string {
  const unique = [...new Set(secrets.map((secret) => secret.trim()).filter((secret) => secret.length >= 6))];
  unique.sort((a, b) => b.length - a.length);
  let out = input;
  for (const secret of unique) {
    if (!out.includes(secret)) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

const SENSITIVE_QUERY = /token|auth|password|secret|session|key/i;

export function stripSensitiveQuery(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let changed = false;
  for (const key of [...parsed.searchParams.keys()]) {
    if (!SENSITIVE_QUERY.test(key)) continue;
    parsed.searchParams.set(key, "redacted");
    changed = true;
  }
  return changed ? parsed.toString() : url;
}

export function scrubCredentialText(input: string, secrets: readonly string[] = []): string {
  const known = scrubKnownSecrets(input, secrets);
  const bearer = known.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{6,}/gi, "Bearer [redacted]");
  return bearer.replace(/([?&](?:access_token|auth|password|token|session|api_key|apikey)=)[^&\s]+/gi, "$1redacted");
}
