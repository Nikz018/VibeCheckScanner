export const FAMILIES = [
  {
    id: "secrets",
    label: "Secrets & leaked credentials",
    blurb: "Private keys and service credentials that shipped in public bundles or files.",
  },
  {
    id: "cloud_backend",
    label: "Cloud backends & storage",
    blurb: "Supabase, Firebase, and buckets left open to the public client.",
  },
  {
    id: "access_control",
    label: "Access control",
    blurb: "Admin surfaces, object ids, and features enforced only in the browser.",
  },
  {
    id: "injection_xss",
    label: "Injection & XSS",
    blurb: "Untrusted input that comes back as HTML, plus prompt leakage from AI routes.",
  },
  {
    id: "auth_session",
    label: "Authentication & session",
    blurb: "Signup, login, callbacks, and webhook authenticity.",
  },
  {
    id: "transport_headers",
    label: "Transport & headers",
    blurb: "HTTPS, browser security headers, CORS, and cookie flags.",
  },
  {
    id: "info_disclosure",
    label: "Information disclosure",
    blurb: "Env files, git metadata, source maps, debug routes, and stack traces.",
  },
  {
    id: "dependencies",
    label: "Dependencies",
    blurb: "Publicly exposed manifests that pin a library to a known-vulnerable version.",
  },
] as const;

export type FamilyId = (typeof FAMILIES)[number]["id"];

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface CheckDefinition {
  id: string;
  module: string;
  family: FamilyId;
  title: string;
  severity: Severity;
  /** 1–10 headline theme. Several checks can share a rank. Null means not a headline check. */
  headlineRank: number | null;
  owaspTop10: string;
  owaspApiTop10: string | null;
  asvs: string;
  cwe: string;
  impact: string;
  fix: string;
}

/**
 * Source of truth for scan coverage.
 * Standards: OWASP Top 10 2021, OWASP API Security Top 10 2023, OWASP ASVS 4.0 chapter, CWE.
 * Headline ranks follow the vibe-coding top 10 (1 is the most urgent).
 */
export const CHECK_CATALOG: CheckDefinition[] = [
  {
    id: "supabase_rls_disabled",
    module: "supabase",
    family: "cloud_backend",
    title: "Supabase table is readable with the public client key",
    severity: "critical",
    headlineRank: 1,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API1:2023 Broken Object Level Authorization",
    asvs: "V4 Access Control",
    cwe: "CWE-284",
    impact:
      "Anyone who loads the app can read rows with the anon key that ships in the browser. Signup data, emails, and private records are exposed even when the UI hides them.",
    fix: `Turn on row level security and add a policy before exposing the table to the anon role.

alter table public.users enable row level security;

create policy "read own row"
on public.users
for select
to authenticated
using (auth.uid() = id);

Repeat for every table in the public schema. In the Supabase dashboard, confirm the anon role cannot select rows you would not paste into a public chat.`,
  },
  {
    id: "firebase_rules_open",
    module: "firebase",
    family: "cloud_backend",
    title: "Firebase data is world-readable",
    severity: "critical",
    headlineRank: 1,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API1:2023 Broken Object Level Authorization",
    asvs: "V4 Access Control",
    cwe: "CWE-732",
    impact:
      "The client config points at a database that returns data without a signed-in user. Anyone who knows the project URL can read it.",
    fix: `Start from deny-all rules, then open only the paths a signed-in user should see.

{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}

Deploy rules before shipping the client config. Do not leave ".read": true or ".write": true on a parent path.`,
  },
  {
    id: "secret_in_client",
    module: "secrets",
    family: "secrets",
    title: "Private credential embedded in client code",
    severity: "critical",
    headlineRank: 2,
    owaspTop10: "A02:2021 Cryptographic Failures",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V8 Data Protection",
    cwe: "CWE-798",
    impact:
      "A service-role key, secret API key, or private token is in JavaScript the browser downloads. Anyone can copy it and act as your server.",
    fix: `Remove the secret from client code and rotate it now. The old value is public.

1. Revoke or roll the key in the provider dashboard.
2. Keep the new value in a server-only variable. Do not prefix it with NEXT_PUBLIC_ or VITE_.
3. Call the provider from a server route, and return only the data the page needs.

Search the repo for the leaked prefix and for NEXT_PUBLIC_ / VITE_ variables that hold private keys.`,
  },
  {
    id: "secret_in_public_path",
    module: "exposure",
    family: "secrets",
    title: "Private credential published on a public path",
    severity: "critical",
    headlineRank: 2,
    owaspTop10: "A02:2021 Cryptographic Failures",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V8 Data Protection",
    cwe: "CWE-538",
    impact:
      "A URL on the site returns live credentials. Crawlers and visitors can collect them without opening the app UI.",
    fix: `Take the file off the public host, rotate every key that was in it, and keep env files out of the deploy artifact.

- Remove .env from the web root and from any static export.
- Add .env* to the host's ignore rules and rebuild.
- Rotate each leaked key after removal. Deleting the file does not invalidate a key that was already downloaded.`,
  },
  {
    id: "admin_surface_open",
    module: "access",
    family: "access_control",
    title: "Admin page or API responds without authentication",
    severity: "critical",
    headlineRank: 3,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API5:2023 Broken Function Level Authorization",
    asvs: "V4 Access Control",
    cwe: "CWE-284",
    impact:
      "An admin page or API returns privileged data to a request that sent no session. Hiding the link in the UI does not protect it.",
    fix: `Check the session on the server before returning admin data.

// example server handler
const session = await getSession(request);
if (!session || session.role !== "admin") {
  return new Response("Forbidden", { status: 403 });
}

Do this in the route that reads or writes data, not only in a client component. Return 401 or 403 when the cookie is missing.`,
  },
  {
    id: "idor_sequential_ids",
    module: "access",
    family: "access_control",
    title: "Sequential ids return other users' records without auth",
    severity: "high",
    headlineRank: 4,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API1:2023 Broken Object Level Authorization",
    asvs: "V4 Access Control",
    cwe: "CWE-639",
    impact:
      "Changing a number in the URL returns a different person's record. Attackers enumerate ids and download the collection.",
    fix: `Authorize every object on the server. Do not trust the id in the URL.

const row = await db.order.findFirst({
  where: { id: params.id, userId: session.userId },
});
if (!row) return new Response("Not found", { status: 404 });

Prefer unguessable ids as a backup, but the real fix is the ownership check. A read of someone else's id should look the same as a missing id.`,
  },
  {
    id: "public_storage_bucket",
    module: "storage",
    family: "cloud_backend",
    title: "Storage bucket is publicly listable",
    severity: "high",
    headlineRank: 5,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V4 Access Control",
    cwe: "CWE-284",
    impact:
      "The bucket listing is public, so files you thought were unlisted can be enumerated and downloaded.",
    fix: `Turn off public listing and serve files through a short-lived signed URL.

- Supabase: set the bucket to private, then create signed URLs on the server after you check the user.
- Firebase Storage: use rules that require auth, for example
  allow read: if request.auth != null && request.auth.uid == userId;
- S3-style buckets: disable public ACLs and block public access at the account level.

A file can stay downloadable by a direct link you handed to its owner without letting the world list every object.`,
  },
  {
    id: "client_side_paywall",
    module: "access",
    family: "access_control",
    title: "Premium access is decided only in the browser",
    severity: "high",
    headlineRank: 6,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API6:2023 Unrestricted Access to Sensitive Business Flows",
    asvs: "V4 Access Control",
    cwe: "CWE-602",
    impact:
      "The paywall is a local flag. Changing local storage or a client variable unlocks paid features without a payment.",
    fix: `Record the purchase on the server and check it there before sending paid data.

const entitled = await db.subscription.findFirst({
  where: { userId: session.userId, status: "active" },
});
if (!entitled) return new Response("Payment required", { status: 402 });

The browser may hide a button, but the API that returns the premium payload has to do the check. Confirm the Stripe webhook updates that row only after a verified event.`,
  },
  {
    id: "stripe_webhook_unsigned",
    module: "authcfg",
    family: "auth_session",
    title: "Stripe webhook accepts requests without a signature",
    severity: "high",
    headlineRank: 6,
    owaspTop10: "A08:2021 Software and Data Integrity Failures",
    owaspApiTop10: "API2:2023 Broken Authentication",
    asvs: "V2 Authentication",
    cwe: "CWE-345",
    impact:
      "Anyone can POST a fake payment event and mark themselves as paid if the handler trusts the body.",
    fix: `Verify the Stripe-Signature header with the webhook secret before reading the event.

const body = await request.text();
const signature = request.headers.get("stripe-signature");
let event;
try {
  event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
} catch {
  return new Response("Invalid signature", { status: 400 });
}

Reject missing or invalid signatures with 400. Do not grant access from the success redirect alone.`,
  },
  {
    id: "llm_endpoint_open",
    module: "llm",
    family: "access_control",
    title: "AI endpoint accepts unauthenticated requests",
    severity: "high",
    headlineRank: 7,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API4:2023 Unrestricted Resource Consumption",
    asvs: "V4 Access Control",
    cwe: "CWE-284",
    impact:
      "An open AI route spends your provider budget and can be driven by anyone who can reach the URL.",
    fix: `Require a session and a rate limit before calling the model.

const session = await getSession(request);
if (!session) return new Response("Unauthorized", { status: 401 });
await rateLimit(\`ai:\${session.userId}\`, { max: 20, windowSeconds: 3600 });

Keep the provider key on the server. Return a generic error when the limit is hit.`,
  },
  {
    id: "llm_prompt_leak",
    module: "llm",
    family: "injection_xss",
    title: "AI endpoint echoes hidden instructions",
    severity: "high",
    headlineRank: 7,
    owaspTop10: "A03:2021 Injection",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V5 Validation, Sanitization and Encoding",
    cwe: "CWE-200",
    impact:
      "A short user message got the route to repeat system instructions or other hidden prompt text. Those instructions often include secrets, policies, or private business rules.",
    fix: `Do not interpolate raw system instructions into a response, and do not trust the model to keep them.

- Authenticate the route and rate-limit it.
- Keep secrets out of the prompt. Pass them as server-side tool calls instead.
- Add a server-side check that refuses to return the system prompt text.
- Treat user text as data, not as a new instruction channel, and filter outputs before they reach the client.`,
  },
  {
    id: "llm_missing_rate_limit",
    module: "llm",
    family: "access_control",
    title: "AI endpoint has no visible rate limit",
    severity: "medium",
    headlineRank: 7,
    owaspTop10: "A04:2021 Insecure Design",
    owaspApiTop10: "API4:2023 Unrestricted Resource Consumption",
    asvs: "V4 Access Control",
    cwe: "CWE-770",
    impact:
      "The AI route answered and did not signal a limit. A loop can run up provider charges or crowd out real users.",
    fix: `Apply a per-user and per-IP limit in the handler and return 429 when it trips.

import { Ratelimit } from "your-limiter";
const limiter = new Ratelimit({ windowMs: 60_000, max: 10 });
const result = await limiter.check(session.userId);
if (!result.ok) return new Response("Slow down", { status: 429 });

Put the limit in front of the provider call, not only in the UI.`,
  },
  {
    id: "exposed_dotenv",
    module: "exposure",
    family: "info_disclosure",
    title: "Environment file is publicly downloadable",
    severity: "critical",
    headlineRank: 8,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V14 Configuration",
    cwe: "CWE-538",
    impact:
      "The site serves an env file. Even values that are not cloud keys often include database URLs and session secrets.",
    fix: `Remove the file from the public directory and block the path at the host.

# example static host / edge rule
location ~ /\\.env { deny all; }

Rebuild without copying .env into the web root. Rotate any secret that was in the file.`,
  },
  {
    id: "exposed_git",
    module: "exposure",
    family: "info_disclosure",
    title: "Git metadata is publicly downloadable",
    severity: "high",
    headlineRank: 8,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V14 Configuration",
    cwe: "CWE-538",
    impact:
      "The .git directory reveals source history. Commits often contain secrets that were deleted later.",
    fix: `Do not deploy the .git folder. Block it and redeploy a clean artifact.

location ~ /\\.git { deny all; }

Build from a bundle or container image that contains only the compiled app. Rotate secrets that ever appeared in history.`,
  },
  {
    id: "exposed_sourcemap",
    module: "exposure",
    family: "info_disclosure",
    title: "JavaScript source map is public",
    severity: "medium",
    headlineRank: 8,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API9:2023 Improper Inventory Management",
    asvs: "V14 Configuration",
    cwe: "CWE-540",
    impact:
      "The source map reconstructs original code, comments, and file paths. That makes hidden routes and logic easy to read.",
    fix: `Stop publishing source maps to production, or require authentication to fetch them.

// next.config example
productionBrowserSourceMaps: false

Delete existing .map files from the host. If you need maps for error tracking, upload them to the tracker and do not leave them beside the bundle.`,
  },
  {
    id: "exposed_debug_route",
    module: "exposure",
    family: "info_disclosure",
    title: "Debug or test route is reachable",
    severity: "medium",
    headlineRank: 8,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V14 Configuration",
    cwe: "CWE-489",
    impact:
      "A debug route answers in the deployed app and leaks environment or internal state that the product UI never shows.",
    fix: `Remove debug routes from the production build.

if (process.env.NODE_ENV === "production") {
  // do not register /debug
}

Gate any health endpoint so it returns only a status code, not env vars or stack traces.`,
  },
  {
    id: "signup_privileged_role",
    module: "authcfg",
    family: "auth_session",
    title: "Client code assigns a privileged role at signup",
    severity: "high",
    headlineRank: 9,
    owaspTop10: "A07:2021 Identification and Authentication Failures",
    owaspApiTop10: "API2:2023 Broken Authentication",
    asvs: "V2 Authentication",
    cwe: "CWE-269",
    impact:
      "The browser chooses a role such as admin. If the server stores that field, anyone can sign up as an administrator.",
    fix: `Ignore any role sent by the client. Set roles on the server from an allow-list you control.

const { email, password } = await request.json();
await db.user.create({
  data: { email, passwordHash, role: "member" },
});

Promote someone to admin in a separate server-only action that checks the caller is already an admin.`,
  },
  {
    id: "login_missing_rate_limit",
    module: "authcfg",
    family: "auth_session",
    title: "Login or OTP endpoint did not rate-limit a short probe",
    severity: "medium",
    headlineRank: 9,
    owaspTop10: "A07:2021 Identification and Authentication Failures",
    owaspApiTop10: "API4:2023 Unrestricted Resource Consumption",
    asvs: "V2 Authentication",
    cwe: "CWE-307",
    impact:
      "The login endpoint accepted repeated failures without a throttle. That enables password and OTP guessing.",
    fix: `Throttle by IP and by account, and return 429 after a small number of failures.

const key = \`login:\${ip}:\${email}\`;
if (await tooManyAttempts(key)) {
  return new Response("Too many attempts", { status: 429 });
}

Keep the same response time for wrong passwords. Apply a tighter limit on one-time codes.`,
  },
  {
    id: "open_redirect",
    module: "authcfg",
    family: "auth_session",
    title: "Auth callback redirects to an arbitrary host",
    severity: "medium",
    headlineRank: 9,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V3 Session Management",
    cwe: "CWE-601",
    impact:
      "A callback parameter sends the browser to another site. After login, people can be walked onto a lookalike page that steals the session they just created.",
    fix: `Allow only relative paths or an explicit list of hosts.

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
return redirect(safeNext(nextParam));

Do not pass a full URL from the query string into the Location header.`,
  },
  {
    id: "cors_credential_wildcard",
    module: "headers",
    family: "transport_headers",
    title: "CORS allows credentials from any origin",
    severity: "high",
    headlineRank: 10,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V9 Communications",
    cwe: "CWE-942",
    impact:
      "A browser on another site can send credentialed requests and read the response. That turns a logged-in user's cookies into a cross-site data leak.",
    fix: `Reflect only origins you operate, and avoid combining a wildcard with credentials.

const allowed = new Set(["https://app.example.com"]);
const origin = request.headers.get("origin");
if (origin && allowed.has(origin)) {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
}

Do not send Access-Control-Allow-Credentials: true together with Access-Control-Allow-Origin: *.`,
  },
  {
    id: "missing_csp",
    module: "headers",
    family: "transport_headers",
    title: "Content-Security-Policy header is missing",
    severity: "medium",
    headlineRank: 10,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V14 Configuration",
    cwe: "CWE-693",
    impact:
      "Without a content security policy, a single injected script can talk to any host and read the page.",
    fix: `Send a policy that limits scripts to your own origin. Start strict and loosen only where a host is required.

Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'

Add the hosts your app actually calls, such as your API and image CDN. Avoid unsafe-inline and unsafe-eval on script-src.`,
  },
  {
    id: "missing_hsts",
    module: "headers",
    family: "transport_headers",
    title: "Strict-Transport-Security header is missing",
    severity: "medium",
    headlineRank: 10,
    owaspTop10: "A02:2021 Cryptographic Failures",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V9 Communications",
    cwe: "CWE-319",
    impact:
      "Browsers will still accept a first request over cleartext, so a network attacker can intercept the session before HTTPS sticks.",
    fix: `Send HSTS on HTTPS responses after the certificate is valid.

Strict-Transport-Security: max-age=15552000; includeSubDomains

Do not set this on a host that still needs plain HTTP. Submit the host to the browser preload list only after every subdomain supports HTTPS.`,
  },
  {
    id: "insecure_cookies",
    module: "headers",
    family: "transport_headers",
    title: "Session cookie is missing Secure, HttpOnly, or SameSite",
    severity: "medium",
    headlineRank: 10,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V3 Session Management",
    cwe: "CWE-614",
    impact:
      "A cookie the browser can read or send over cleartext is easier to steal with script injection or a shared network.",
    fix: `Set the session cookie from the server with all three flags.

Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax; Path=/

HttpOnly keeps script from reading it. Secure keeps it on HTTPS. SameSite=Lax blocks most cross-site sends. Use SameSite=Strict when the app does not need cross-site navigation into an authenticated page.`,
  },
  {
    id: "verbose_errors",
    module: "exposure",
    family: "info_disclosure",
    title: "Error response includes a stack trace",
    severity: "medium",
    headlineRank: 10,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V7 Error Handling and Logging",
    cwe: "CWE-209",
    impact:
      "Stack traces show framework versions, file paths, and query fragments. That shortens the path to the next bug.",
    fix: `Log the stack on the server and return a short message to the client.

try {
  await handler(request);
} catch (error) {
  console.error(error);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}

Turn off framework debug pages in production.`,
  },
  {
    id: "weak_tls",
    module: "headers",
    family: "transport_headers",
    title: "Transport security is weak or missing",
    severity: "high",
    headlineRank: null,
    owaspTop10: "A02:2021 Cryptographic Failures",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V9 Communications",
    cwe: "CWE-326",
    impact:
      "The site is easy to intercept or impersonate. Sessions and API keys sent over that channel can be copied.",
    fix: `Serve the app only over HTTPS with a current certificate and TLS 1.2 or newer.

- Put the app behind a host that terminates TLS.
- Redirect port 80 to HTTPS.
- Disable TLS 1.0 and 1.1.
- Renew the certificate before it expires.`,
  },
  {
    id: "missing_frame_protection",
    module: "headers",
    family: "transport_headers",
    title: "Page can be framed by other sites",
    severity: "low",
    headlineRank: null,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V14 Configuration",
    cwe: "CWE-1021",
    impact:
      "Another site can embed this page in a frame and trick a signed-in person into clicking controls they cannot see clearly.",
    fix: `Deny framing unless you have a specific embed use case.

Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY

If a partner must embed a page, list that origin in frame-ancestors instead of removing the header.`,
  },
  {
    id: "missing_content_type_options",
    module: "headers",
    family: "transport_headers",
    title: "X-Content-Type-Options is missing",
    severity: "low",
    headlineRank: null,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V14 Configuration",
    cwe: "CWE-693",
    impact:
      "Browsers may sniff a file as HTML or script even when you meant to serve it as data.",
    fix: `Send this on every response:

X-Content-Type-Options: nosniff

Also send an explicit Content-Type for downloads and API responses.`,
  },
  {
    id: "missing_referrer_policy",
    module: "headers",
    family: "transport_headers",
    title: "Referrer-Policy is missing",
    severity: "low",
    headlineRank: null,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V14 Configuration",
    cwe: "CWE-200",
    impact:
      "Full URLs, including tokens in the query string, can leak to other sites through the Referer header.",
    fix: `Set a conservative referrer policy.

Referrer-Policy: strict-origin-when-cross-origin

Keep secrets out of query strings even after you set the header.`,
  },
  {
    id: "reflected_xss",
    module: "injection",
    family: "injection_xss",
    title: "Query text is reflected into HTML without encoding",
    severity: "high",
    headlineRank: null,
    owaspTop10: "A03:2021 Injection",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V5 Validation, Sanitization and Encoding",
    cwe: "CWE-79",
    impact:
      "A crafted link can run script in a visitor's session because the server copies the query string into HTML as markup.",
    fix: `Encode untrusted text when you insert it into HTML, or render it as text.

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

In React, avoid dangerouslySetInnerHTML for request data. Pair this with a Content-Security-Policy that does not allow unsafe inline scripts.`,
  },
  {
    id: "dom_xss_sink",
    module: "injection",
    family: "injection_xss",
    title: "Client code writes HTML from a sink",
    severity: "medium",
    headlineRank: null,
    owaspTop10: "A03:2021 Injection",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V5 Validation, Sanitization and Encoding",
    cwe: "CWE-79",
    impact:
      "The bundle assigns markup with innerHTML, document.write, or eval. If any of that string includes user or URL data, it becomes script execution.",
    fix: `Use text APIs instead of HTML APIs.

element.textContent = userValue;
// instead of element.innerHTML = userValue

If you must render HTML, sanitize it with a maintained allow-list on the server and keep a strict Content-Security-Policy. Do not eval strings that came from the network.`,
  },
  {
    id: "vulnerable_dependency",
    module: "dependencies",
    family: "dependencies",
    title: "Public manifest pins a dependency with a known vulnerability",
    severity: "high",
    headlineRank: null,
    owaspTop10: "A06:2021 Vulnerable and Outdated Components",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V10 Malicious Code",
    cwe: "CWE-1395",
    impact:
      "The deployed app advertises a library version with a published vulnerability, and the manifest itself is public.",
    fix: `Upgrade the package past the affected version and redeploy. Then stop publishing the manifest.

npm install lodash@4.17.21

Use the fixed version named in the finding. Remove package.json and the lockfile from the public host so version details stay in your repo.`,
  },
  {
    id: "exposed_package_manifest",
    module: "exposure",
    family: "info_disclosure",
    title: "Package manifest is publicly downloadable",
    severity: "low",
    headlineRank: null,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API9:2023 Improper Inventory Management",
    asvs: "V14 Configuration",
    cwe: "CWE-538",
    impact:
      "package.json tells visitors exactly which libraries and versions the app claims to run.",
    fix: `Do not copy package.json into the public web root. Publish the built assets only.

A container or static export should contain the compiled output, not the manifest you use in development.`,
  },
  {
    id: "directory_listing",
    module: "storage",
    family: "cloud_backend",
    title: "A public directory listing exposes stored files",
    severity: "medium",
    headlineRank: null,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API8:2023 Security Misconfiguration",
    asvs: "V4 Access Control",
    cwe: "CWE-548",
    impact:
      "The server prints a file index. Visitors can open uploads that were never linked from the app.",
    fix: `Disable auto-indexing on the host and put uploads behind an authorization check.

# nginx
autoindex off;

Serve user files through a route that checks the session, or use signed URLs that expire.`,
  },
  {
    id: "client_backend_config",
    module: "secrets",
    family: "info_disclosure",
    title: "Backend client configuration is embedded in the bundle",
    severity: "info",
    headlineRank: null,
    owaspTop10: "A05:2021 Security Misconfiguration",
    owaspApiTop10: "API9:2023 Improper Inventory Management",
    asvs: "V14 Configuration",
    cwe: "CWE-200",
    impact:
      "The public bundle names the backend project. A public anon key is expected, and it is safe only when server-side rules reject unauthorized reads and writes.",
    fix: `Keep the anon or client key in the browser if the vendor designed it that way, and lock the server down.

- Enable row level security or security rules on every table and bucket.
- Never put the service role or a private key next to the client config.
- Treat the client key as public. Review the other findings in this report before you rely on it.`,
  },
  {
    id: "auth_idor_bola",
    module: "authenticated",
    family: "access_control",
    title: "Signed-in user can read another account's record",
    severity: "high",
    headlineRank: null,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API1:2023 Broken Object Level Authorization",
    asvs: "V4 Access Control",
    cwe: "CWE-639",
    impact:
      "A test account received another account's object by replaying the request or by swapping the id. Hiding the link is not a control.",
    fix: `Load the row only when it belongs to the signed-in user.

const row = await db.note.findFirst({
  where: { id: params.id, userId: session.userId },
});
if (!row) return new Response("Not found", { status: 404 });

Return the same 404 for a missing id and for someone else's id.`,
  },
  {
    id: "auth_vertical_privilege",
    module: "authenticated",
    family: "access_control",
    title: "A normal signed-in user can open an admin route",
    severity: "critical",
    headlineRank: null,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API5:2023 Broken Function Level Authorization",
    asvs: "V4 Access Control",
    cwe: "CWE-285",
    impact:
      "An account that is not an admin still received admin data. A hidden URL is not an access check.",
    fix: `Check the role on the server for every admin page and API.

const session = await getSession(request);
if (!session || session.role !== "admin") {
  return new Response("Forbidden", { status: 403 });
}

Do this in the handler that reads the data, not only in the navigation.`,
  },
  {
    id: "auth_paywall_bypass",
    module: "authenticated",
    family: "access_control",
    title: "A free signed-in account can read a premium route",
    severity: "high",
    headlineRank: null,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API6:2023 Unrestricted Access to Sensitive Business Flows",
    asvs: "V4 Access Control",
    cwe: "CWE-639",
    impact:
      "A test account that is not on a paid plan received premium content. The paywall in the interface is not enforced on the server.",
    fix: `Check the purchase on the server before returning paid data.

const entitled = await db.subscription.findFirst({
  where: { userId: session.userId, status: "active" },
});
if (!entitled) return new Response("Payment required", { status: 402 });

The browser may hide a button. The API still has to refuse the read.`,
  },
  {
    id: "auth_sensitive_exposure",
    module: "authenticated",
    family: "info_disclosure",
    title: "A signed-in response exposes other people's data or a secret",
    severity: "high",
    headlineRank: null,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API3:2023 Broken Object Property Level Authorization",
    asvs: "V8 Data Protection",
    cwe: "CWE-200",
    impact:
      "A signed-in response included other people's email addresses or a private credential. The UI can hide a field that the API still returns.",
    fix: `Return only the fields the signed-in user should see, and keep secrets on the server.

const me = await db.user.findUnique({
  where: { id: session.userId },
  select: { id: true, email: true },
});
return Response.json(me);

Do not select every column, and do not ship service keys in authenticated JavaScript.`,
  },
  {
    id: "auth_session_weakness",
    module: "authenticated",
    family: "auth_session",
    title: "Signed-in session cookie or token is weak",
    severity: "medium",
    headlineRank: null,
    owaspTop10: "A07:2021 Identification and Authentication Failures",
    owaspApiTop10: "API2:2023 Broken Authentication",
    asvs: "V3 Session Management",
    cwe: "CWE-613",
    impact:
      "The session cookie is missing browser protections, or the token does not expire, or it carries a sensitive claim. A stolen token stays useful for longer than it should.",
    fix: `Set the cookie flags on the server and give the token an expiry. This scan does not sign the account out.

Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax; Path=/

Keep passwords and API keys out of the token. Reject alg none. Store a server-side session if you need to revoke it before exp.`,
  },
  {
    id: "auth_backend_cross_user",
    module: "authenticated",
    family: "cloud_backend",
    title: "A signed-in user token can read other users' backend rows",
    severity: "critical",
    headlineRank: null,
    owaspTop10: "A01:2021 Broken Access Control",
    owaspApiTop10: "API1:2023 Broken Object Level Authorization",
    asvs: "V4 Access Control",
    cwe: "CWE-284",
    impact:
      "A normal signed-in token could read rows that belong to other people. A public client key is safe only when rules limit each user to their own rows.",
    fix: `Turn on row level security or security rules that match the signed-in user.

create policy "read own row"
on public.users
for select
to authenticated
using (auth.uid() = id);

For Firebase, allow read only when auth.uid matches the path. Do not grant the signed-in role a table-wide select.`,
  },
];

export const CHECKS_BY_ID: Record<string, CheckDefinition> = Object.fromEntries(
  CHECK_CATALOG.map((check) => [check.id, check]),
);

export function getCheck(id: string): CheckDefinition {
  const check = CHECKS_BY_ID[id];
  if (!check) throw new Error(`Unknown check: ${id}`);
  return check;
}

export function familyLabel(id: FamilyId): string {
  return FAMILIES.find((family) => family.id === id)?.label ?? id;
}

export function checksForFamily(family: FamilyId): CheckDefinition[] {
  return CHECK_CATALOG.filter((check) => check.family === family);
}

export const HEADLINE_THEMES: { rank: number; title: string; summary: string }[] = [
  {
    rank: 1,
    title: "Open Supabase or Firebase data",
    summary: "Tables or realtime data readable or writable with the public client key.",
  },
  {
    rank: 2,
    title: "Secrets in the client or a public env file",
    summary: "Service-role keys, provider secret keys, and NEXT_PUBLIC_ / VITE_ leaks.",
  },
  {
    rank: 3,
    title: "Admin without server-side auth",
    summary: "Admin pages, APIs, or tables that answer with no session.",
  },
  {
    rank: 4,
    title: "Guessable object ids",
    summary: "Sequential ids that return another user's data to a read-only request.",
  },
  {
    rank: 5,
    title: "Public storage buckets",
    summary: "Buckets or upload folders that can be listed.",
  },
  {
    rank: 6,
    title: "Browser paywalls and unsigned webhooks",
    summary: "Premium flags checked only in the client, or a payment webhook with no signature check.",
  },
  {
    rank: 7,
    title: "Open AI endpoints",
    summary: "Model routes with no auth, no rate limit, or a system-prompt leak.",
  },
  {
    rank: 8,
    title: "Exposed project files",
    summary: ".env, .git, source maps, and debug or test routes.",
  },
  {
    rank: 9,
    title: "Weak auth configuration",
    summary: "Client-side admin roles, unlimited login attempts, and open redirects.",
  },
  {
    rank: 10,
    title: "Headers, CORS, cookies, and verbose errors",
    summary: "Wildcard CORS with credentials, missing CSP or HSTS, insecure cookies, stack traces.",
  },
];

export function renderChecklistMarkdown(): string {
  const lines: string[] = [];
  lines.push("# VibeCheck security checklist");
  lines.push("");
  lines.push("This document is the coverage map for the MVP scanner. The typed source of truth is `CHECK_CATALOG` in `src/lib/catalog.ts`. Customer reports never include this mapping and never name the libraries used to collect evidence.");
  lines.push("");
  lines.push("Standards referenced below:");
  lines.push("");
  lines.push("- OWASP Top 10 (2021)");
  lines.push("- OWASP API Security Top 10 (2023), when the check is about an API or backend");
  lines.push("- OWASP ASVS 4.0 chapter");
  lines.push("- CWE");
  lines.push("");
  lines.push("Active scans run only after the account proves domain ownership (DNS TXT or `/.well-known/vibecheck-verify.txt`) and checks the consent box. Probes are read-only except for tiny unauthenticated POSTs used to see whether a webhook, login, or AI route rejects bad input, and except the single login request when a paid scan is given throwaway test accounts. The worker never sends PUT, PATCH, or DELETE. Signed-in checks replay and compare with GET and HEAD only.");
  lines.push("");
  lines.push("Paid full reports can include those signed-in checks. The customer supplies up to two throwaway test accounts, or a session cookie or bearer token for each. The free teaser does not run them. Credentials are encrypted with CREDENTIALS_ENCRYPTION_KEY and deleted when the scan finishes or after 24 hours. Reports mask secrets, cookies, and tokens.");
  lines.push("");
  lines.push("## Families");
  lines.push("");
  lines.push("| Family id | Customer label |");
  lines.push("| --- | --- |");
  for (const family of FAMILIES) {
    lines.push(`| \`${family.id}\` | ${family.label} |`);
  }
  lines.push("");
  lines.push("## Headline top 10");
  lines.push("");
  lines.push("These themes sort first in paid reports. They sit on top of the full catalog. They do not replace it. A free preview shows the lowest-severity finding, not the headline rank.");
  lines.push("");
  for (const theme of HEADLINE_THEMES) {
    const ids = CHECK_CATALOG.filter((check) => check.headlineRank === theme.rank).map((check) => `\`${check.id}\``);
    lines.push(`${theme.rank}. **${theme.title}** — ${theme.summary} Checks: ${ids.join(", ")}.`);
  }
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  for (const family of FAMILIES) {
    lines.push(`### ${family.label} (\`${family.id}\`)`);
    lines.push("");
    lines.push(family.blurb);
    lines.push("");
    lines.push("| Check | Module | Severity | Headline | OWASP Top 10 | OWASP API Top 10 | ASVS | CWE |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const check of checksForFamily(family.id)) {
      lines.push(
        `| \`${check.id}\` | \`${check.module}\` | ${check.severity} | ${check.headlineRank ?? "—"} | ${check.owaspTop10} | ${check.owaspApiTop10 ?? "—"} | ${check.asvs} | ${check.cwe} |`,
      );
    }
    lines.push("");
  }
  lines.push("## What a customer report shows");
  lines.push("");
  lines.push("Reports group findings by the eight families and include a coverage row for each family: ran, pass, findings, not run, or not completed. A paid finding shows a title, severity, evidence, impact, the exact location that was tested, the request and a short redacted response, steps to reproduce, and a copy-paste fix. The owner of an unlocked scan can download that report as a PDF or as a Markdown file to paste into an AI coding assistant. The free teaser keeps one finding, the lowest severity, in full detail, plus the true total and the count for each severity. Every other finding is left out of the page, the download, and the email. Score, scan date, and the public badge are derived from severities. The badge and share page show the score out of 100 and the date only, and they switch to a rescan-needed state 30 days after the scan.");
  lines.push("");
  lines.push("## What this scan does not cover");
  lines.push("");
  lines.push("- Business-logic flaws, such as a workflow that does the wrong thing for a valid user.");
  lines.push("- Write or delete abuse. Probes are read-only, so a bug that only appears when data is changed is not proven.");
  lines.push("- Source code and dependencies, unless a repository is connected or a manifest is already public.");
  lines.push("- Load testing and brute-force testing.");
  lines.push("- Mobile apps and backends that are not part of this web origin.");
  lines.push("");
  lines.push("A manual pentest is a better fit when you need those covered in depth.");
  lines.push("");
  return lines.join("\n");
}
