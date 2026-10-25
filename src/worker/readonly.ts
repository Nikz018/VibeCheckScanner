export class MutatingMethodError extends Error {
  constructor(method: string) {
    super(`Refusing ${method.toUpperCase()}: logged-in checks are read-only`);
    this.name = "MutatingMethodError";
  }
}

const READ_ONLY = new Set(["GET", "HEAD"]);

export function assertReadOnlyMethod(method: string): void {
  const upper = method.toUpperCase();
  if (READ_ONLY.has(upper)) return;
  throw new MutatingMethodError(upper || "UNKNOWN");
}

/** The only mutating request a signed-in scan may send is POST to the login URL itself. */
export function assertLoginPost(method: string, url: string, allowedUrls: string[]): void {
  if (method.toUpperCase() !== "POST") throw new MutatingMethodError(method || "UNKNOWN");
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new MutatingMethodError("POST");
  }
  const allowed = allowedUrls.some((candidate) => {
    try {
      const login = new URL(candidate);
      return login.origin === target.origin && login.pathname === target.pathname;
    } catch {
      return false;
    }
  });
  if (!allowed) throw new MutatingMethodError("POST");
}

const ACTION_PATH =
  /(^|\/)(logout|sign-?out|log-?out|delete|destroy|settings|billing|checkout|password|deactivate|unsubscribe)(\/|$)/i;

export function isActionUrl(url: string): boolean {
  try {
    const parsed = new URL(url, "http://localhost");
    return ACTION_PATH.test(parsed.pathname);
  } catch {
    return true;
  }
}

export async function guardedRequest(
  method: string,
  url: string,
  loginUrls: string[] | null,
  run: () => Promise<void>,
): Promise<void> {
  if (loginUrls && method.toUpperCase() === "POST") assertLoginPost(method, url, loginUrls);
  else assertReadOnlyMethod(method);
  await run();
}
