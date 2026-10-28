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
  /(^|\/)(logout|sign-?out|log-?out|log-?off|delete|remove|destroy|unsubscribe|cancel|settings|billing|checkout|password|deactivate)(\/|$)/i;

const ACTION_KEY = /^(?:action|method|op|do)$/i;
const ACTION_VALUE = /^(?:logout|sign-?out|log-?out|log-?off|delete|remove|destroy|unsubscribe|cancel)$/i;

/** GET can still sign a visitor out or delete data, so these URLs are never fetched. */
export function isActionUrl(url: string): boolean {
  try {
    const parsed = new URL(url, "http://localhost");
    if (ACTION_PATH.test(parsed.pathname)) return true;
    for (const [key, value] of parsed.searchParams) {
      if (ACTION_VALUE.test(key)) return true;
      if (ACTION_KEY.test(key) && (value === "" || ACTION_VALUE.test(value))) return true;
    }
    return false;
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
