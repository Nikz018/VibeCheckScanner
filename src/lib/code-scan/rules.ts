import type { AdvisoryHit } from "@/lib/osv";
import { packageAdvisoryKey } from "@/lib/osv";
import type { Severity } from "@/lib/catalog";
import { jwtRole, sanitizeCode, sanitizeCustomerText } from "@/lib/sanitize";
import { abandonedPackages, typosquatPackages } from "./dependencies";
import { maskSecretsInText, maskSnippet } from "./mask";
import type { CodeFamily, CodeFinding, HistoryHit, OwaspId, RuleScope, SourceFile } from "./types";

export interface RepoFacts {
  files: SourceFile[];
  javascript: SourceFile[];
  sql: SourceFile[];
  firebase: SourceFile[];
  history: HistoryHit[];
  packageNames: string[];
  locked: Array<{ name: string; version: string }>;
  advisories: Map<string, AdvisoryHit[]>;
  hasManifest: boolean;
  hasLockfile: boolean;
}

export interface Rule {
  id: string;
  scope: RuleScope;
  /** Categories this rule marks as checked when its scope is active. */
  owasp: OwaspId[];
  run: (repo: RepoFacts) => CodeFinding[];
}

const KEYS: Array<{ id: string; label: string; ai: boolean; source: string }> = [
  { id: "anthropic", label: "an Anthropic API key", ai: true, source: "\\bsk-ant-[A-Za-z0-9_-]{10,}" },
  { id: "openai_proj", label: "an OpenAI API key", ai: true, source: "\\bsk-proj-[A-Za-z0-9_-]{10,}" },
  { id: "groq", label: "a Groq API key", ai: true, source: "\\bgsk_[A-Za-z0-9]{16,}" },
  { id: "xai", label: "an xAI API key", ai: true, source: "\\bxai-[A-Za-z0-9_-]{12,}" },
  { id: "openai", label: "an OpenAI API key", ai: true, source: "\\bsk-[A-Za-z0-9_-]{16,}" },
  { id: "stripe_live", label: "a Stripe live secret key", ai: false, source: "\\bsk_live_[A-Za-z0-9]{8,}" },
  { id: "stripe", label: "a Stripe secret key", ai: false, source: "\\bsk_test_[A-Za-z0-9]{8,}" },
  { id: "aws", label: "an AWS access key id", ai: false, source: "\\bAKIA[0-9A-Z]{16}\\b" },
  { id: "github", label: "a GitHub token", ai: false, source: "\\bghp_[A-Za-z0-9]{20,}" },
  { id: "pem", label: "a private key", ai: false, source: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----" },
];

function makeFinding(input: {
  ruleId: string;
  family: CodeFamily;
  file: string;
  line: number;
  snippet: string;
  severity: Severity;
  title: string;
  explanation: string;
  owasp: OwaspId;
  fixPrompt: string;
}): CodeFinding {
  return {
    ruleId: input.ruleId,
    family: input.family,
    file: input.file.replace(/\\/g, "/"),
    line: input.line,
    snippet: maskSnippet(input.snippet),
    severity: input.severity,
    title: sanitizeCustomerText(input.title),
    explanation: sanitizeCustomerText(input.explanation),
    owasp: input.owasp,
    fixPrompt: sanitizeCode(maskSecretsInText(input.fixPrompt)),
  };
}

function lineAt(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function lineText(text: string, line: number): string {
  return text.split(/\r?\n/)[line - 1] ?? "";
}

function firstMatch(text: string, source: string): { line: number; snippet: string } | null {
  const expression = new RegExp(source, "i");
  const match = expression.exec(text);
  if (!match || match.index === undefined) return null;
  const line = lineAt(text, match.index);
  return { line, snippet: lineText(text, line) || match[0].split(/\r?\n/)[0] };
}

function eachMatch(text: string, source: string): Array<{ line: number; snippet: string; value: string }> {
  const expression = new RegExp(source, "gi");
  const hits: Array<{ line: number; snippet: string; value: string }> = [];
  for (const match of text.matchAll(expression)) {
    if (match.index === undefined) continue;
    const line = lineAt(text, match.index);
    hits.push({ line, snippet: lineText(text, line) || match[0].split(/\r?\n/)[0], value: match[0] });
  }
  return hits;
}

function promptFor(file: string, line: number, problem: string, change: string): string {
  return `Fix this security issue in the app. File: ${file} line ${line}.\nProblem: ${problem}\nChange: ${change}\nDo not print secrets. Keep the rest of the behavior the same.`;
}

function isServerPath(file: string, text: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  if (/(?:^|\/)(?:app\/api|pages\/api|server)\//.test(normalized)) return true;
  if (/\.server\.[a-z]+$/.test(normalized)) return true;
  if (/^\s*["']use server["']/.test(text) && !/use client/.test(text)) return true;
  return false;
}

function isClientPath(file: string, text: string): boolean {
  if (isServerPath(file, text)) return false;
  const normalized = file.replace(/\\/g, "/");
  if (normalized.includes("/components/")) return true;
  if (/use client/.test(text)) return true;
  if (/\.(jsx|tsx)$/.test(normalized)) return true;
  if (/(?:^|\/)app\//.test(normalized)) return true;
  return false;
}

function isApiRoute(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  return /(?:^|\/)app\/api\/(?:.*\/)?route\.[cm]?[jt]sx?$/.test(normalized) || /(?:^|\/)pages\/api\/.+\.[cm]?[jt]sx?$/.test(normalized);
}

function isAuthRoute(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  return /\/(?:login|signin|sign-up|signup|register)\/route\.[a-z]+$/.test(normalized)
    || /\/api\/(?:login|signin|sign-up|signup|register)\.[a-z]+$/.test(normalized)
    || /\/api\/auth\/(?:login|signin|sign-up|signup|register)\/route\.[a-z]+$/.test(normalized);
}

function isAdminRoute(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  return /\/admin\/(?:.*\/)?route\.[a-z]+$/.test(normalized) || /\/api\/admin\.[a-z]+$/.test(normalized);
}

const AUTH = /getSession|getCurrentUser|auth\(\)|requireUser|requireAuth|getUser\(|getServerSession|cookies\(\)|authorization|withAuth|clerkMiddleware|createServerClient/;
const DATA = /\.from\(|prisma\.|sql`|db\.query|collection\(|findUnique|findFirst|findMany/;
const HANDLER = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)\b/;
const RATE = /rateLimit|ratelimit|rateLimiter|limiter|upstash/i;

function secretsRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  for (const file of repo.files) {
    if (file.kind === "lock") continue;
    for (const key of KEYS) {
      for (const hit of eachMatch(file.text, key.source)) {
        if (key.id === "openai" && (hit.value.startsWith("sk-ant-") || hit.value.startsWith("sk-proj-"))) continue;
        const ai = key.ai;
        findings.push(
          makeFinding({
            ruleId: ai ? "code_ai_provider_key" : "code_secret_hardcoded",
            family: ai ? "AI security" : "Secrets",
            file: file.relativePath,
            line: hit.line,
            snippet: hit.snippet,
            severity: "critical",
            title: ai ? "Model provider key is in the repository" : "Secret is hardcoded in the repository",
            explanation: `This line contains ${key.label}. Anyone who can read the repository, or the built app if this file is bundled, can use it.`,
            owasp: "A02:2021",
            fixPrompt: promptFor(
              file.relativePath,
              hit.line,
              `Remove ${key.label} from source.`,
              "Move the value to a server-only environment variable, rotate the old key, and read it only on the server.",
            ),
          }),
        );
      }
    }
    for (const hit of eachMatch(file.text, "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{4,}")) {
      if (jwtRole(hit.value) !== "service_role") continue;
      const client = isClientPath(file.relativePath, file.text);
      findings.push(
        makeFinding({
          ruleId: client ? "code_secret_service_role_client" : "code_secret_hardcoded",
          family: "Secrets",
          file: file.relativePath,
          line: hit.line,
          snippet: hit.snippet,
          severity: "critical",
          title: client ? "Supabase service-role key is in client code" : "Supabase service-role key is hardcoded",
          explanation: client
            ? "A Supabase service-role key bypasses row level security. This file looks like client code, so the key can ship to the browser."
            : "A Supabase service-role key is in source. It bypasses row level security and should only live in a server environment variable.",
          owasp: "A02:2021",
          fixPrompt: promptFor(
            file.relativePath,
            hit.line,
            "Remove the service-role key from this file.",
            "Rotate the key in the Supabase dashboard. Keep the new value in a server-only variable and never prefix it with NEXT_PUBLIC_ or VITE_.",
          ),
        }),
      );
    }
    if (/(?:^|\/)(?:app\/api|pages\/api|server)\//.test(file.relativePath)) {
      // Service-role assignment by name in server files is still a hardcoded secret.
    }
    const namedService = firstMatch(file.text, "SUPABASE_SERVICE_ROLE(?:_KEY)?\\s*[:=]\\s*[\"'`][^\"'`]{8,}");
    if (namedService && isClientPath(file.relativePath, file.text)) {
      findings.push(
        makeFinding({
          ruleId: "code_secret_service_role_client",
          family: "Secrets",
          file: file.relativePath,
          line: namedService.line,
          snippet: namedService.snippet,
          severity: "critical",
          title: "Supabase service-role key is in client code",
          explanation: "A service-role key is assigned in a file that can be bundled for the browser. That key bypasses row level security.",
          owasp: "A02:2021",
          fixPrompt: promptFor(file.relativePath, namedService.line, "Remove the service-role key from client code.", "Read it only in a server route and rotate the leaked key."),
        }),
      );
    }
    const publicVar = firstMatch(
      file.text,
      "(?:NEXT_PUBLIC|VITE)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|API_KEY)[A-Z0-9_]*\\s*[:=]\\s*[\"'`][^\"'`]{6,}",
    );
    if (publicVar) {
      findings.push(
        makeFinding({
          ruleId: "code_secret_public_env",
          family: "Secrets",
          file: file.relativePath,
          line: publicVar.line,
          snippet: publicVar.snippet,
          severity: "critical",
          title: "Server secret is in a public environment variable",
          explanation: "Variables that start with NEXT_PUBLIC_ or VITE_ are included in the browser bundle. A secret in that name is visible to every visitor.",
          owasp: "A02:2021",
          fixPrompt: promptFor(
            file.relativePath,
            publicVar.line,
            "A public env prefix is holding a server secret.",
            "Rename it to a server-only variable, rotate the value, and call the provider from a server route.",
          ),
        }),
      );
    }
    if (file.kind === "env") {
      findings.push(
        makeFinding({
          ruleId: "code_secret_env_file",
          family: "Secrets",
          file: file.relativePath,
          line: 1,
          snippet: lineText(file.text, 1) || "(empty env file)",
          severity: "critical",
          title: "Environment file is committed",
          explanation: "An env file is in the repository. Those files often hold live keys, and deleting the file later does not remove it from history.",
          owasp: "A02:2021",
          fixPrompt: promptFor(file.relativePath, 1, "An env file is tracked.", "Remove it from the tree and from git history, add it to the ignore file, and rotate every value that was committed."),
        }),
      );
    }
  }
  return dedupe(findings);
}

function historyRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  const seen = new Set<string>();
  for (const hit of repo.history) {
    const env = isHistoryEnv(hit.path);
    const secret = KEYS.some((key) => new RegExp(key.source, "i").test(hit.lineText)) || /service_role/.test(hit.lineText);
    if (!env && !secret) continue;
    const key = `${hit.commit}:${hit.path}:${env ? "env" : hit.lineText.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const short = hit.commit.slice(0, 7);
    findings.push(
      makeFinding({
        ruleId: "code_secret_git_history",
        family: "Secrets",
        file: `history ${short}:${hit.path}`,
        line: 1,
        snippet: hit.lineText,
        severity: "high",
        title: env ? "Environment file appears in recent commits" : "A secret appears in recent commits",
        explanation: env
          ? `Commit ${short} adds an env file. Recent history is limited, and the copy of the repository is not kept.`
          : `Commit ${short} adds a line that looks like a secret. Removing the file in a later commit does not erase this history.`,
        owasp: "A02:2021",
        fixPrompt: promptFor(
          hit.path,
          1,
          "A secret or env file is in recent git history.",
          "Rotate the value, then purge the file from history before the repository is shared. Do not paste the old value into chat.",
        ),
      }),
    );
    if (findings.length >= 10) break;
  }
  return findings;
}

function isHistoryEnv(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? "";
  if (base === ".env.example" || base === ".env.sample" || base === ".env.template") return false;
  return base === ".env" || base.startsWith(".env.");
}

function dependencyRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  for (const item of repo.locked) {
    const key = packageAdvisoryKey(item.name.toLowerCase(), item.version.replace(/^v/i, ""));
    const hits = repo.advisories.get(key) ?? repo.advisories.get(packageAdvisoryKey(item.name, item.version)) ?? [];
    for (const advisory of hits) {
      findings.push(
        makeFinding({
          ruleId: "code_dependency_advisory",
          family: "Dependencies",
          file: "package-lock.json",
          line: 1,
          snippet: `${item.name}@${item.version}`,
          severity: advisory.severity,
          title: `${item.name} ${item.version} has a published vulnerability`,
          explanation: `${advisory.summary} The identifier is ${advisory.id}.${advisory.fixed ? ` A fixed release is ${advisory.fixed}.` : ""} The version comes from the lockfile.`,
          owasp: "A06:2021",
          fixPrompt: promptFor(
            "package-lock.json",
            1,
            `${item.name}@${item.version} matches ${advisory.id}.`,
            advisory.fixed
              ? `Upgrade ${item.name} to ${advisory.fixed} or newer, update the lockfile, and reinstall.`
              : `Upgrade ${item.name} to a release that addresses ${advisory.id}, update the lockfile, and reinstall.`,
          ),
        }),
      );
    }
  }
  for (const name of abandonedPackages(repo.packageNames)) {
    findings.push(
      makeFinding({
        ruleId: "code_dependency_abandoned",
        family: "Dependencies",
        file: "package.json",
        line: 1,
        snippet: name,
        severity: "medium",
        title: `${name} looks abandoned`,
        explanation: `${name} is a package that is no longer maintained. Bugs in it will not get fixes.`,
        owasp: "A06:2021",
        fixPrompt: promptFor("package.json", 1, `${name} is unmaintained.`, `Replace ${name} with a maintained package and remove it from the lockfile.`),
      }),
    );
  }
  for (const hit of typosquatPackages(repo.packageNames)) {
    findings.push(
      makeFinding({
        ruleId: "code_dependency_typosquat",
        family: "Dependencies",
        file: "package.json",
        line: 1,
        snippet: hit.name,
        severity: "high",
        title: `${hit.name} looks like a typosquat of ${hit.looksLike}`,
        explanation: `The dependency name is one small edit away from ${hit.looksLike}. That pattern is how lookalike packages get installed.`,
        owasp: "A06:2021",
        fixPrompt: promptFor("package.json", 1, `${hit.name} resembles ${hit.looksLike}.`, `Confirm the package is the one you meant. If it is a typo, switch to ${hit.looksLike} and reinstall.`),
      }),
    );
  }
  return findings;
}

function accessRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  for (const file of repo.javascript) {
    if (!isApiRoute(file.relativePath) || !HANDLER.test(file.text)) continue;
    const hasAuth = AUTH.test(file.text);
    const hasData = DATA.test(file.text);
    if (hasData && !hasAuth) {
      const place = firstMatch(file.text, "export\\s+(?:async\\s+)?function\\s+(?:GET|POST|PUT|PATCH|DELETE)|export\\s+const\\s+(?:GET|POST)");
      findings.push(
        makeFinding({
          ruleId: "code_access_no_auth",
          family: "Access control",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? "handler",
          severity: "high",
          title: "API route uses data without an auth check",
          explanation: "This route reads or writes data and the file does not check a session or user. Hiding the link in the interface does not protect the route.",
          owasp: "A01:2021",
          fixPrompt: promptFor(
            file.relativePath,
            place?.line ?? 1,
            "The handler touches data before it knows who is calling.",
            "Load the session on the server and return 401 when it is missing, before the query runs.",
          ),
        }),
      );
    }
    const idFromUser = /params\.id|params\[["']id["']\]|searchParams\.get\(\s*["']id["']\)|req\.params\.id|req\.query\.id/.test(file.text);
    const owner = /userId|user_id|ownerId|owner_id|auth\.uid|session\.user|eq\(\s*["']user/.test(file.text);
    if (idFromUser && hasData && !owner) {
      const place = firstMatch(file.text, "params\\.id|searchParams\\.get\\(\\s*[\"']id[\"']\\)|req\\.params\\.id");
      findings.push(
        makeFinding({
          ruleId: "code_access_idor",
          family: "Access control",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? "id",
          severity: "high",
          title: "Record id from the request is used without an owner filter",
          explanation: "The handler takes an id from the request and uses it in a query. The file does not also limit the row to the signed-in user, so changing the id can read someone else's record.",
          owasp: "A01:2021",
          fixPrompt: promptFor(
            file.relativePath,
            place?.line ?? 1,
            "The query trusts an id from the URL or body.",
            "Add the signed-in user id to the query filter and return 404 when the row is not theirs.",
          ),
        }),
      );
    }
    if (isAdminRoute(file.relativePath) && !/isAdmin|requireAdmin|role\s*!==?\s*["']admin["']|session\.role|user\.role/.test(file.text)) {
      findings.push(
        makeFinding({
          ruleId: "code_access_admin",
          family: "Access control",
          file: file.relativePath,
          line: 1,
          snippet: file.relativePath,
          severity: "critical",
          title: "Admin route has no role check",
          explanation: "This route lives under an admin path and the file does not check an admin role. Any caller who can hit the URL can use it.",
          owasp: "A01:2021",
          fixPrompt: promptFor(file.relativePath, 1, "The admin route does not check a role.", "Require a signed-in admin on the server and return 403 for everyone else."),
        }),
      );
    }
  }
  return findings;
}

function databaseRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  const sqlText = repo.sql.map((file) => file.text).join("\n");
  for (const file of repo.sql) {
    for (const match of file.text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public\.)?[a-zA-Z0-9_]+)/gi)) {
      const table = match[1];
      const bare = table.split(".").pop() ?? table;
      const enabled = new RegExp(`alter\\s+table\\s+(?:public\\.)?${bare}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sqlText);
      if (enabled) continue;
      const line = lineAt(file.text, match.index ?? 0);
      findings.push(
        makeFinding({
          ruleId: "code_db_rls_missing",
          family: "Database",
          file: file.relativePath,
          line,
          snippet: lineText(file.text, line),
          severity: "critical",
          title: `Table ${bare} has no row level security`,
          explanation: `The migration creates ${table} and the SQL in this repository never enables row level security for it. The public client key can read the table when the API allows it.`,
          owasp: "A01:2021",
          fixPrompt: promptFor(
            file.relativePath,
            line,
            `${bare} is created without row level security.`,
            `Enable row level security on ${bare} and add a policy that limits rows to the signed-in user before shipping the client key.`,
          ),
        }),
      );
    }
    const permissive = firstMatch(file.text, "using\\s*\\(\\s*true\\s*\\)|with\\s+check\\s*\\(\\s*true\\s*\\)");
    if (permissive) {
      findings.push(
        makeFinding({
          ruleId: "code_db_rls_permissive",
          family: "Database",
          file: file.relativePath,
          line: permissive.line,
          snippet: permissive.snippet,
          severity: "high",
          title: "Row level security policy allows every row",
          explanation: "A policy uses true as the check. That allows the role named in the policy to read or write every row.",
          owasp: "A01:2021",
          fixPrompt: promptFor(file.relativePath, permissive.line, "The policy expression is true.", "Replace it with a check that compares the row owner to the signed-in user id."),
        }),
      );
    }
  }
  for (const file of repo.firebase) {
    const open = firstMatch(file.text, "\"\\.?(?:read|write)\"\\s*:\\s*true|allow\\s+read\\s*,\\s*write\\s*:\\s*if\\s+true|allow\\s+(?:read|write)\\s*:\\s*if\\s+true");
    if (!open) continue;
    findings.push(
      makeFinding({
        ruleId: "code_db_firebase_open",
        family: "Database",
        file: file.relativePath,
        line: open.line,
        snippet: open.snippet,
        severity: "critical",
        title: "Firebase rules allow public read or write",
        explanation: "These rules allow access without a signed-in user. Anyone who knows the project can read or change the data.",
        owasp: "A01:2021",
        fixPrompt: promptFor(file.relativePath, open.line, "Firebase rules allow open access.", "Start from deny-all and allow a path only when the signed-in user matches the owner."),
      }),
    );
  }
  const sources = [...repo.javascript, ...repo.sql, ...repo.files.filter((file) => file.language === "python")];
  for (const file of sources) {
    const concat = firstMatch(
      file.text,
      "(?:select|insert|update|delete)\\b[\\s\\S]{0,180}(?:\\$\\{\\s*(?:req|request|body|params|query|input|user|searchParams)|\\+\\s*(?:req|request|body|params|query|input|user|searchParams))",
    );
    if (!concat) continue;
    findings.push(
      makeFinding({
        ruleId: "code_db_sql_concat",
        family: "Database",
        file: file.relativePath,
        line: concat.line,
        snippet: concat.snippet,
        severity: "critical",
        title: "SQL is built with user input",
        explanation: "A SQL statement is assembled with a template or string join that includes request data. An attacker can change the query.",
        owasp: "A03:2021",
        fixPrompt: promptFor(file.relativePath, concat.line, "User input is concatenated into SQL.", "Use bound parameters or a query builder. Do not insert request values into the SQL string."),
      }),
    );
  }
  return dedupe(findings);
}

function injectionRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  for (const file of repo.javascript) {
    const html = firstMatch(file.text, "dangerouslySetInnerHTML|\\.innerHTML\\s*=");
    if (html && !/__html\s*:\s*["'`]/.test(html.snippet) && !/innerHTML\s*=\s*["'`]/.test(html.snippet)) {
      const userish = /props|params|user|data|html|content|message|children|input|query|body/.test(file.text);
      if (userish || /dangerouslySetInnerHTML/.test(html.snippet)) {
        findings.push(
          makeFinding({
            ruleId: "code_inject_html",
            family: "Injection and output",
            file: file.relativePath,
            line: html.line,
            snippet: html.snippet,
            severity: "high",
            title: "HTML is rendered from data",
            explanation: "The page writes HTML from a value instead of text. If that value includes user content, the browser will run it.",
            owasp: "A03:2021",
            fixPrompt: promptFor(file.relativePath, html.line, "HTML is set from a variable.", "Render text, or sanitize the HTML with a strict allow-list before it reaches the page."),
          }),
        );
      }
    }
    const evaluated = firstMatch(file.text, "(?:^|[^\\w])eval\\s*\\(|new\\s+Function\\s*\\(");
    if (evaluated && !/eval\s*\(\s*["'`]/.test(evaluated.snippet) && !/new\s+Function\s*\(\s*["'`]/.test(evaluated.snippet)) {
      findings.push(
        makeFinding({
          ruleId: "code_inject_eval",
          family: "Injection and output",
          file: file.relativePath,
          line: evaluated.line,
          snippet: evaluated.snippet,
          severity: "critical",
          title: "Code is executed from a value",
          explanation: "eval or Function will run a string as code. If any part of that string comes from a user, they can run code in your process.",
          owasp: "A03:2021",
          fixPrompt: promptFor(file.relativePath, evaluated.line, "eval or Function is called.", "Replace it with a direct function call. Do not execute strings built from input."),
        }),
      );
    }
    const command = firstMatch(file.text, "(?:exec|execSync|spawn|spawnSync)\\s*\\(");
    if (command && !/(?:exec|execSync|spawn|spawnSync)\s*\(\s*["'][^"']+["']\s*[,)]/.test(command.snippet)) {
      findings.push(
        makeFinding({
          ruleId: "code_inject_command",
          family: "Injection and output",
          file: file.relativePath,
          line: command.line,
          snippet: command.snippet,
          severity: "critical",
          title: "A shell command is built from a value",
          explanation: "A process is started with a command that is not a fixed string. User input in that command can run other programs.",
          owasp: "A03:2021",
          fixPrompt: promptFor(file.relativePath, command.line, "The command is not a fixed string.", "Call a fixed executable and pass arguments as an array. Do not build a shell string from input."),
        }),
      );
    }
    const fetchHit = firstMatch(file.text, "fetch\\s*\\(\\s*(?:req\\.|request\\.|searchParams|params\\.|body\\.|`[^`]*\\$\\{[^}]*(?:req|searchParams|params|body|user|input))");
    if (fetchHit) {
      findings.push(
        makeFinding({
          ruleId: "code_inject_ssrf",
          family: "Injection and output",
          file: file.relativePath,
          line: fetchHit.line,
          snippet: fetchHit.snippet,
          severity: "high",
          title: "The server fetches a URL from the request",
          explanation: "fetch is called with a URL that comes from the request. A caller can point it at internal services.",
          owasp: "A10:2021",
          fixPrompt: promptFor(file.relativePath, fetchHit.line, "The fetch URL is user-controlled.", "Allow only known hosts, or refuse the request. Do not pass the raw URL to fetch."),
        }),
      );
    }
    const redirect = firstMatch(file.text, "(?:redirect|res\\.redirect)\\s*\\(\\s*(?:searchParams|req\\.query|req\\.body|params\\.|next\\b|destination)");
    if (redirect) {
      findings.push(
        makeFinding({
          ruleId: "code_inject_redirect",
          family: "Injection and output",
          file: file.relativePath,
          line: redirect.line,
          snippet: redirect.snippet,
          severity: "medium",
          title: "Redirect target comes from the request",
          explanation: "The redirect destination is taken from the request. A crafted link can send a signed-in user to another site.",
          owasp: "A01:2021",
          fixPrompt: promptFor(file.relativePath, redirect.line, "The redirect target is not checked.", "Allow only relative paths on this site, or a fixed list of destinations."),
        }),
      );
    }
    const upload = /writeFile|writeFileSync|putObject/.test(file.text) && /formData|req\.file|multer/.test(file.text);
    if (upload && !/mimetype|mime|content-type|allowedTypes|fileFilter|maxSize|file\.size/i.test(file.text)) {
      const place = firstMatch(file.text, "writeFile|writeFileSync|putObject");
      findings.push(
        makeFinding({
          ruleId: "code_inject_upload",
          family: "Injection and output",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? "upload",
          severity: "medium",
          title: "Upload is saved without a type or size check",
          explanation: "The handler writes an uploaded file and does not check the type or size. That can store unexpected content.",
          owasp: "A04:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "The upload is not validated.", "Allow only expected types, reject large files, and store them outside the public web root."),
        }),
      );
    }
  }
  return dedupe(findings);
}

function configRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  for (const file of repo.javascript.concat(repo.files.filter((item) => item.kind === "config"))) {
    const cors = firstMatch(file.text, "Access-Control-Allow-Origin[\"']?\\s*[:=]\\s*[\"']\\*[\"']|origin\\s*:\\s*[\"']\\*[\"']|origin\\s*:\\s*true");
    if (cors) {
      findings.push(
        makeFinding({
          ruleId: "code_config_cors",
          family: "Configuration",
          file: file.relativePath,
          line: cors.line,
          snippet: cors.snippet,
          severity: "medium",
          title: "CORS allows any origin",
          explanation: "The cross-origin policy is a wildcard or reflects every origin. Browsers on other sites can call this API.",
          owasp: "A05:2021",
          fixPrompt: promptFor(file.relativePath, cors.line, "CORS is open to every origin.", "Set the allowed origin to your site. Do not combine a wildcard with credentials."),
        }),
      );
    }
    if (/^next\.config\./.test(file.relativePath.split("/").pop() ?? "") && !/content-security-policy|Content-Security-Policy|X-Frame-Options|strict-transport-security|headers\s*\(/i.test(file.text)) {
      findings.push(
        makeFinding({
          ruleId: "code_config_headers",
          family: "Configuration",
          file: file.relativePath,
          line: 1,
          snippet: lineText(file.text, 1) || "next config",
          severity: "low",
          title: "Security headers are not set in the app config",
          explanation: "The Next config does not set a content security policy, frame protection, or strict transport security. Browsers will not get those protections from this file.",
          owasp: "A05:2021",
          fixPrompt: promptFor(file.relativePath, 1, "Security headers are missing from the app config.", "Add headers for Content-Security-Policy, X-Frame-Options, and Strict-Transport-Security."),
        }),
      );
    }
    if (/\.stack\b/.test(file.text) && /NextResponse\.json|res\.json|res\.send/.test(file.text)) {
      const place = firstMatch(file.text, "\\.stack\\b");
      if (place) {
        findings.push(
          makeFinding({
            ruleId: "code_config_debug",
            family: "Configuration",
            file: file.relativePath,
            line: place.line,
            snippet: place.snippet,
            severity: "medium",
            title: "Error details can be returned to the client",
            explanation: "The handler references an error stack and also sends a JSON or text response. Stack traces in production show internal paths and library versions.",
            owasp: "A05:2021",
            fixPrompt: promptFor(file.relativePath, place.line, "A stack trace is available to the response.", "Log the stack on the server and return a short message to the client."),
          }),
        );
      }
    }
    if (isAuthRoute(file.relativePath) && HANDLER.test(file.text) && !RATE.test(file.text)) {
      findings.push(
        makeFinding({
          ruleId: "code_config_rate_limit",
          family: "Configuration",
          file: file.relativePath,
          line: 1,
          snippet: file.relativePath,
          severity: "medium",
          title: "Auth route has no rate limit",
          explanation: "This login or signup route does not limit how often it can be called. Attackers can guess passwords or create accounts without a delay.",
          owasp: "A07:2021",
          fixPrompt: promptFor(file.relativePath, 1, "The auth route is not rate limited.", "Limit attempts per IP and per account, and return 429 when the limit is hit."),
        }),
      );
    }
    const cookie = firstMatch(file.text, "httpOnly\\s*:\\s*false|secure\\s*:\\s*false|sameSite\\s*:\\s*[\"']none[\"']");
    if (cookie && /cookie|setCookie|cookies\(/i.test(file.text)) {
      findings.push(
        makeFinding({
          ruleId: "code_config_cookie",
          family: "Configuration",
          file: file.relativePath,
          line: cookie.line,
          snippet: cookie.snippet,
          severity: "medium",
          title: "Session cookie flags are weak",
          explanation: "The cookie is readable by scripts, sent over plain HTTP, or allowed on cross-site requests. A stolen session cookie signs the attacker in.",
          owasp: "A07:2021",
          fixPrompt: promptFor(file.relativePath, cookie.line, "Cookie flags are weak.", "Set httpOnly and secure to true, and use a strict or lax sameSite value."),
        }),
      );
    }
    if (/createHash\(\s*["'](?:md5|sha1)["']\)/.test(file.text) && /password/i.test(file.text)) {
      const place = firstMatch(file.text, "createHash\\(\\s*[\"'](?:md5|sha1)[\"']\\)");
      findings.push(
        makeFinding({
          ruleId: "code_config_hash",
          family: "Configuration",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? "hash",
          severity: "high",
          title: "Passwords are hashed with a fast checksum",
          explanation: "MD5 and SHA-1 are fast to guess. They are not suitable for passwords.",
          owasp: "A02:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "A password is hashed with MD5 or SHA-1.", "Use a slow password hash such as bcrypt, scrypt, or argon2, and re-hash on the next sign-in."),
        }),
      );
    }
  }
  return dedupe(findings);
}

function paymentRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  for (const file of repo.javascript) {
    const webhook = /webhook/i.test(file.relativePath) && /stripe|payment|dodo|checkout/i.test(file.text);
    if (webhook && !/constructEvent|stripe-signature|webhook-signature|webhookSecret|standardwebhooks|verifySignature/i.test(file.text)) {
      findings.push(
        makeFinding({
          ruleId: "code_pay_webhook",
          family: "Payments",
          file: file.relativePath,
          line: 1,
          snippet: file.relativePath,
          severity: "critical",
          title: "Payment webhook does not check a signature",
          explanation: "This webhook handler talks about a payment and does not verify the provider signature. Anyone can post a fake paid event.",
          owasp: "A08:2021",
          fixPrompt: promptFor(file.relativePath, 1, "The webhook body is trusted without a signature.", "Verify the provider signature with the webhook secret before changing an order."),
        }),
      );
    }
    const clientPrice = /body\.(?:amount|price|paid)\b|(?:amount|price|paid)\s*:\s*(?:body|req\.body|payload)\./.test(file.text);
    if (clientPrice && /stripe|checkout|payment|order/i.test(file.text) && !/constructEvent|stripe-signature/i.test(file.text)) {
      const place = firstMatch(file.text, "body\\.(?:amount|price|paid)|(?:amount|price|paid)\\s*:\\s*(?:body|req\\.body|payload)\\.");
      findings.push(
        makeFinding({
          ruleId: "code_pay_client_price",
          family: "Payments",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? "price",
          severity: "critical",
          title: "Price or paid status comes from the client",
          explanation: "The handler trusts an amount or paid flag sent by the browser. A caller can change the price or mark an order paid.",
          owasp: "A04:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "The client supplies the price or paid flag.", "Look up the price on the server and set paid only after a verified payment event."),
        }),
      );
    }
  }
  return findings;
}

function loggingRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  const pattern = /console\.(?:log|info|debug|warn|error)\s*\(([^)\n]{0,180})\)/g;
  for (const file of repo.files) {
    if (file.language !== "javascript" && file.language !== "python") continue;
    const source = file.language === "python" ? file.text : file.text;
    const expression = file.language === "python" ? /(?:print|logger\.\w+)\s*\(([^)\n]{0,180})\)/g : pattern;
    for (const match of source.matchAll(expression)) {
      const args = match[1] ?? "";
      if (/^[\s"'`]/.test(args) && !/(password|secret|api[_-]?key|token|prompt|email)/i.test(args.replace(/["'`][^"'`]*["'`]/g, ""))) continue;
      if (!/(password|secret|api[_-]?key|token|prompt|email|ssn)/i.test(args)) continue;
      if (/^[\s]*["'`][^"'`]*["'`]\s*$/.test(args)) continue;
      const line = lineAt(file.text, match.index ?? 0);
      findings.push(
        makeFinding({
          ruleId: "code_log_sensitive",
          family: "Logging",
          file: file.relativePath,
          line,
          snippet: lineText(file.text, line),
          severity: "medium",
          title: "Logs include a secret or personal data",
          explanation: "This log line includes a password, token, prompt, email, or similar value. Logs are often stored and shared more widely than the app.",
          owasp: "A09:2021",
          fixPrompt: promptFor(file.relativePath, line, "A log statement includes sensitive data.", "Remove the value from the log. Log an id or a result code instead."),
        }),
      );
    }
  }
  return dedupe(findings);
}

function aiRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  for (const file of repo.javascript) {
    const callsModel = /openai|anthropic|generateText|chat\.completions|GoogleGenerativeAI|new Groq|messages\.create/i.test(file.text);
    const aiRoute = isApiRoute(file.relativePath) && (/\/api\/(?:chat|ai|generate|completions|openai|anthropic)\//.test(file.relativePath) || callsModel);
    if (aiRoute && callsModel && !AUTH.test(file.text)) {
      findings.push(
        makeFinding({
          ruleId: "code_ai_endpoint_auth",
          family: "AI security",
          file: file.relativePath,
          line: 1,
          snippet: file.relativePath,
          severity: "high",
          title: "AI endpoint does not check who is calling",
          explanation: "This route calls a model and does not check a session. Anyone who can reach the URL can spend your model budget.",
          owasp: "A01:2021",
          fixPrompt: promptFor(file.relativePath, 1, "The model route has no auth check.", "Require a session before calling the model and reject anonymous requests."),
        }),
      );
    }
    if (aiRoute && callsModel && !RATE.test(file.text) && !/spend|budget|maxSpend/i.test(file.text)) {
      findings.push(
        makeFinding({
          ruleId: "code_ai_endpoint_limit",
          family: "AI security",
          file: file.relativePath,
          line: 1,
          snippet: file.relativePath,
          severity: "medium",
          title: "AI endpoint has no rate limit or spend cap",
          explanation: "The route can call a model without a per-user limit or a spend cap. A loop of requests can run up the bill.",
          owasp: "A04:2021",
          fixPrompt: promptFor(file.relativePath, 1, "The model route has no limit.", "Add a per-user rate limit and a daily spend cap before the provider is called."),
        }),
      );
    }
    const injection = firstMatch(
      file.text,
      "role\\s*:\\s*[\"']system[\"'][\\s\\S]{0,240}\\$\\{[^}]*(?:user|input|message|prompt|query)|systemPrompt\\s*\\+\\s*(?:user|input|message)|`[^`]*(?:You are|system)[^`]*\\$\\{[^}]*(?:user|input|message|prompt)",
    );
    if (injection) {
      findings.push(
        makeFinding({
          ruleId: "code_ai_prompt_injection",
          family: "AI security",
          file: file.relativePath,
          line: injection.line,
          snippet: injection.snippet,
          severity: "high",
          title: "User text is concatenated into the system prompt",
          explanation: "User input is placed in the system instructions. A user can try to override those instructions.",
          owasp: "A03:2021",
          fixPrompt: promptFor(file.relativePath, injection.line, "User text is inside the system prompt.", "Keep the system prompt fixed. Pass user text as a separate user message and ignore requests to change the instructions."),
        }),
      );
    }
    const promptSecret = firstMatch(file.text, "(?:systemPrompt|system\\s*:|role\\s*:\\s*[\"']system[\"'])[\\s\\S]{0,200}(?:sk-|sk_live_|sk-ant-|gsk_|api[_-]?key)");
    if (promptSecret) {
      findings.push(
        makeFinding({
          ruleId: "code_ai_prompt_secret",
          family: "AI security",
          file: file.relativePath,
          line: promptSecret.line,
          snippet: promptSecret.snippet,
          severity: "critical",
          title: "A secret is written into the model prompt",
          explanation: "The system prompt contains a key or the word for one. Models can repeat prompt text back to the user, and providers store prompts.",
          owasp: "A02:2021",
          fixPrompt: promptFor(file.relativePath, promptSecret.line, "A secret is inside the prompt.", "Remove it, rotate the key, and give the model only the data that task needs."),
        }),
      );
    }
    const sink = firstMatch(file.text, "dangerouslySetInnerHTML[\\s\\S]{0,120}(?:completion|message\\.content|choices)|eval\\s*\\([^)]*(?:completion|llm|choices)|(?:exec|queryRawUnsafe|query)\\s*\\([^)]*(?:completion|llmOutput|modelOutput)");
    if (sink) {
      findings.push(
        makeFinding({
          ruleId: "code_ai_output_sink",
          family: "AI security",
          file: file.relativePath,
          line: sink.line,
          snippet: sink.snippet,
          severity: "high",
          title: "Model output is treated as code, HTML, or SQL",
          explanation: "Text from the model is rendered as HTML, executed, or placed in a query or shell command. The model can be talked into producing that payload.",
          owasp: "A03:2021",
          fixPrompt: promptFor(file.relativePath, sink.line, "Model output is used as HTML, code, SQL, or a command.", "Treat model text as untrusted data. Do not execute it or insert it into SQL or a shell."),
        }),
      );
    }
    if (/tools\s*:\s*\[|functions\s*:\s*\[/.test(file.text) && /delete|drop|transfer|refund|charge/i.test(file.text) && !/confirm|allowlist|allowedTools/i.test(file.text)) {
      const place = firstMatch(file.text, "tools\\s*:\\s*\\[|functions\\s*:\\s*\\[");
      findings.push(
        makeFinding({
          ruleId: "code_ai_tool_unconfirmed",
          family: "AI security",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? "tools",
          severity: "high",
          title: "Model tools can take a destructive action without a check",
          explanation: "The model can call a tool that deletes, transfers, refunds, or charges, and the file has no confirmation step or allow-list.",
          owasp: "A04:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "A model tool can change or destroy data on its own.", "Allow only named tools and require a person to confirm destructive actions."),
        }),
      );
    }
    if (/match_documents|similaritySearch|vectorSearch|\.rpc\(\s*["']match/.test(file.text) && !/user_id|tenant|owner_id|ownerId/.test(file.text)) {
      const place = firstMatch(file.text, "match_documents|similaritySearch|vectorSearch|\\.rpc\\(\\s*[\"']match");
      findings.push(
        makeFinding({
          ruleId: "code_ai_rag_tenant",
          family: "AI security",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? "vector",
          severity: "high",
          title: "Vector search has no per-user filter",
          explanation: "The retrieval query does not filter by user or tenant. One user can receive another user's documents in the model context.",
          owasp: "A01:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "The vector query is not limited to one tenant.", "Add the signed-in user or tenant id to the filter before documents are sent to the model."),
        }),
      );
    }
    if (callsModel && /console\.(?:log|info|debug)\s*\(\s*(?:messages|prompt|fullPrompt|systemPrompt)/.test(file.text)) {
      const place = firstMatch(file.text, "console\\.(?:log|info|debug)\\s*\\(\\s*(?:messages|prompt|fullPrompt|systemPrompt)");
      findings.push(
        makeFinding({
          ruleId: "code_ai_prompt_logged",
          family: "AI security",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? "log",
          severity: "medium",
          title: "Full prompts are written to logs",
          explanation: "The prompt or message list is logged. Prompts often contain personal data and hidden instructions.",
          owasp: "A09:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "The full prompt is logged.", "Stop logging prompts. Log a request id and token count instead."),
        }),
      );
    }
    if (callsModel && /chat\.completions\.create|messages\.create|generateContent/.test(file.text) && !/max_tokens|maxTokens|max_completion_tokens|maxOutputTokens/.test(file.text)) {
      const place = firstMatch(file.text, "chat\\.completions\\.create|messages\\.create|generateContent");
      findings.push(
        makeFinding({
          ruleId: "code_ai_no_max_tokens",
          family: "AI security",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? "model",
          severity: "low",
          title: "Model call does not set a token limit",
          explanation: "The model request does not set a maximum output length. A long reply costs more and can be abused to drain the budget.",
          owasp: "A04:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "The model call has no max token setting.", "Set a max token limit and pin the model name you intend to pay for."),
        }),
      );
    }
    const gemini = /gemini|generativelanguage/i.test(file.text) ? firstMatch(file.text, "\\bAIza[0-9A-Za-z_\\-]{30,}") : null;
    if (gemini) {
      findings.push(
        makeFinding({
          ruleId: "code_ai_provider_key",
          family: "AI security",
          file: file.relativePath,
          line: gemini.line,
          snippet: gemini.snippet,
          severity: "critical",
          title: "Model provider key is in the repository",
          explanation: "This line contains a Gemini-style API key next to a Gemini or generative language setting. It should not be in source or in the browser bundle.",
          owasp: "A02:2021",
          fixPrompt: promptFor(file.relativePath, gemini.line, "A Gemini key is in source.", "Move it to a server-only variable and rotate the key."),
        }),
      );
    }
  }
  return dedupe(findings);
}

function dedupe(findings: CodeFinding[]): CodeFinding[] {
  const seen = new Set<string>();
  const unique: CodeFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.ruleId}:${finding.file}:${finding.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  return unique;
}

const secretRules: Rule[] = [
  { id: "secrets", scope: "agnostic", owasp: ["A02:2021"], run: secretsRule },
  { id: "history", scope: "agnostic", owasp: ["A02:2021"], run: historyRule },
];

const javascriptRules: Rule[] = [
  { id: "access", scope: "javascript", owasp: ["A01:2021"], run: accessRule },
  { id: "injection", scope: "javascript", owasp: ["A03:2021", "A10:2021", "A01:2021", "A04:2021"], run: injectionRule },
  { id: "config", scope: "javascript", owasp: ["A05:2021", "A07:2021", "A02:2021"], run: configRule },
  { id: "payments", scope: "javascript", owasp: ["A08:2021", "A04:2021"], run: paymentRule },
  { id: "logging", scope: "agnostic", owasp: ["A09:2021"], run: loggingRule },
  { id: "ai", scope: "javascript", owasp: ["A01:2021", "A04:2021", "A03:2021", "A02:2021", "A09:2021"], run: aiRule },
];

/** Add Python rules here. The walker already labels .py files as language "python". */
export const PYTHON_RULES: Rule[] = [];

export const RULES: Rule[] = [
  ...secretRules,
  { id: "dependencies", scope: "manifest", owasp: ["A06:2021"], run: dependencyRule },
  { id: "database", scope: "sql", owasp: ["A01:2021", "A03:2021"], run: (repo) => databaseRule(repo).filter((finding) => finding.ruleId !== "code_db_firebase_open") },
  { id: "firebase", scope: "firebase", owasp: ["A01:2021"], run: (repo) => databaseRule(repo).filter((finding) => finding.ruleId === "code_db_firebase_open") },
  { id: "sql-in-code", scope: "agnostic", owasp: ["A03:2021"], run: (repo) => databaseRule(repo).filter((finding) => finding.ruleId === "code_db_sql_concat") },
  ...javascriptRules,
  ...PYTHON_RULES,
];

export function scopeActive(scope: RuleScope, repo: RepoFacts): boolean {
  if (repo.files.length === 0 && repo.history.length === 0) return false;
  if (scope === "agnostic") return repo.files.length > 0 || repo.history.length > 0;
  if (scope === "javascript") return repo.javascript.length > 0;
  if (scope === "sql") return repo.sql.length > 0;
  if (scope === "firebase") return repo.firebase.length > 0;
  if (scope === "manifest") return repo.hasManifest || repo.hasLockfile;
  return false;
}
