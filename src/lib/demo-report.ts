import { CHECK_CATALOG } from "./catalog";
import { scannerUserAgent } from "./scanner-identity";
import type { FindingLocation, FindingProof } from "./finding-detail";
import { buildCustomerReport, type CheckRunState, type CustomerReport, type RawCheckResult } from "./report";

const EVIDENCE: Record<string, string> = {
  supabase_rls_disabled:
    "The public client key could read users (2 row sample, fields id, email). Write methods are advertised for this table.",
  firebase_rules_open: "The database URL returned JSON without a user credential. Top-level keys: users.",
  secret_in_client: "Public JavaScript included a service-role credential and a Stripe secret key. The values were redacted.",
  admin_surface_open: "These paths returned privileged content with no session cookie: /admin, /api/admin/users.",
  idor_sequential_ids: "GET /api/users/1 and GET /api/users/2 both returned different records with no session cookie.",
  public_storage_bucket: "The storage API listed 1 bucket: avatars.",
  client_side_paywall: "Client code gates premium access with a localStorage flag named plan.",
  stripe_webhook_unsigned: "An unsigned empty POST was accepted: /api/stripe/webhook returned 200.",
  llm_endpoint_open: "POST /api/chat returned 200 with no session cookie.",
  llm_prompt_leak: "POST /api/chat included hidden instruction text in the response. The text was not copied into this report.",
  exposed_dotenv: "These paths returned environment files: /.env.",
  signup_privileged_role: "Public client code sends role: \"admin\" during signup.",
  open_redirect: "/auth/callback redirected to example.com based on the next parameter.",
  cors_credential_wildcard:
    "A cross-origin request was answered with Access-Control-Allow-Origin: * and Access-Control-Allow-Credentials: true.",
  missing_csp: "The homepage response did not include a Content-Security-Policy header.",
  reflected_xss: "The q query parameter was copied into the HTML response without encoding a < character.",
  vulnerable_dependency: "The public manifest lists lodash@4.17.15 (CVE-2021-23337: Prototype pollution in lodash before 4.17.21).",
};

function demoWhere(checkId: string): { locations: FindingLocation[]; proof: FindingProof; steps: string[] } {
  const secret = checkId.includes("secret");
  const method = checkId === "stripe_webhook_unsigned" || checkId.startsWith("llm_") ? "POST" : "GET";
  const url = secret ? "https://sample.example/assets/app.js" : `https://sample.example/${checkId.replaceAll("_", "-")}`;
  const location: FindingLocation = { method, url };
  if (secret) {
    location.line = 12;
    location.column = 7;
    location.maskedSecret = "sk_t…0000";
  }
  return {
    locations: [location],
    proof: {
      method,
      url,
      headers: [
        { name: "user-agent", value: scannerUserAgent() },
        { name: "accept", value: "*/*" },
      ],
      status: 200,
      responseSnippet: "HTTP 200\ncontent-type: application/json\n\n{\"sample\":true}",
    },
    steps: [`Send ${method} ${url} with no session cookie.`, "The response matches the evidence in this sample finding."],
  };
}

export function buildDemoReport(now = new Date("2026-10-24T12:00:00.000Z")): CustomerReport {
  const results: RawCheckResult[] = Object.entries(EVIDENCE).map(([checkId, evidence]) => ({
    checkId,
    evidence,
    ...demoWhere(checkId),
  }));
  const marked = Object.fromEntries(CHECK_CATALOG.map((check) => [check.id, "ok"])) as Record<string, CheckRunState>;
  return buildCustomerReport({
    scanId: "demo",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: now,
    results,
    marked,
    now,
  });
}
