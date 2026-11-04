import type { AdvisoryHit } from "@/lib/osv";
import { packageAdvisoryKey } from "@/lib/osv";
import type { Severity } from "@/lib/catalog";
import { jwtRole, sanitizeCode, sanitizeCustomerText } from "@/lib/sanitize";
import { abandonedPackages, typosquatPackages } from "./dependencies";
import { maskSecretsInText, maskSnippet } from "./mask";
import {
  SIGNATURE_SIGNAL,
  findAcceptedSecrets,
  hasCodeSignal,
  isGitIgnored,
  languageOf,
  lineHasRegexSource,
  looksLikeRealSecret,
  quotedValue,
  reachableFiles,
  regionAt,
  reachesSignatureVerification,
  type ScanLanguage,
} from "./signals";
import type { CodeFamily, CodeFinding, HistoryHit, OwaspId, RuleScope, SourceFile } from "./types";

export interface RepoFacts {
  root: string;
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

function firstMatch(
  text: string,
  source: string,
  language: ScanLanguage = "javascript",
): { index: number; line: number; snippet: string; value: string } | null {
  for (const hit of eachMatch(text, source, language)) return hit;
  return null;
}

function eachMatch(
  text: string,
  source: string,
  language: ScanLanguage = "javascript",
): Array<{ index: number; line: number; snippet: string; value: string }> {
  const expression = new RegExp(source, "gi");
  const hits: Array<{ index: number; line: number; snippet: string; value: string }> = [];
  for (const match of text.matchAll(expression)) {
    if (match.index === undefined) continue;
    if (regionAt(text, match.index, language) === "comment") continue;
    const line = lineAt(text, match.index);
    hits.push({ index: match.index, line, snippet: lineText(text, line) || match[0].split(/\r?\n/)[0], value: match[0] });
  }
  return hits;
}

function reachableSignal(file: SourceFile, repo: RepoFacts, source: string): boolean {
  return reachableFiles(file, repo.files, 2).some((item) => hasCodeSignal(item.text, source, languageOf(item)));
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

const AUTH_SIGNAL =
  "getSession|readSession|getCurrentUser|auth\\(\\)|requireUser|requireAuth|requirePaid|getUser\\(|getServerSession|cookies\\(\\)|authorization|withAuth|clerkMiddleware|createServerClient|shareToken|verify\\w*Webhook";
const ROLE_SIGNAL = "isAdmin|requireAdmin|role\\s*!==?\\s*[\"']admin[\"']|session\\.role|user\\.role";
const DATA = /\.from\(|prisma\.|sql`|db\.query|collection\(|findUnique|findFirst|findMany/;
const HANDLER = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)\b/;
const RATE_SIGNAL = "rateLimit|ratelimit|rateLimiter|\\blimiter\\b|upstash";

function secretOnLine(file: SourceFile, index: number, valueLength = 0): boolean {
  const line = lineText(file.text, lineAt(file.text, index));
  if (lineHasRegexSource(line)) return false;
  if (regionAt(file.text, index, languageOf(file)) === "comment") return false;
  if (file.text[index - 1] === "<" && file.text[index + valueLength] === ">") return false;
  return true;
}

function secretsRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  for (const file of repo.files) {
    if (file.kind === "lock") continue;
    if (file.kind === "env" && isGitIgnored(repo.root, file.relativePath)) continue;
    for (const hit of findAcceptedSecrets(file.text)) {
      if (!secretOnLine(file, hit.index, hit.value.length)) continue;
      const ai = hit.ai;
      findings.push(
        makeFinding({
          ruleId: ai ? "code_ai_provider_key" : "code_secret_hardcoded",
          family: ai ? "AI security" : "Secrets",
          file: file.relativePath,
          line: lineAt(file.text, hit.index),
          snippet: lineText(file.text, lineAt(file.text, hit.index)) || hit.value.split(/\r?\n/)[0],
          severity: "critical",
          title: ai ? "Model provider key is in the repository" : "Secret is hardcoded in the repository",
          explanation: `This line contains ${hit.label}. Anyone who can read the repository, or the built app if this file is bundled, can use it.`,
          owasp: "A02:2021",
          fixPrompt: promptFor(
            file.relativePath,
            lineAt(file.text, hit.index),
            `Remove ${hit.label} from source.`,
            "Move the value to a server-only environment variable, rotate the old key, and read it only on the server.",
          ),
        }),
      );
    }
    for (const hit of eachMatch(file.text, "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{4,}", languageOf(file))) {
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
    const namedService = firstMatch(file.text, "SUPABASE_SERVICE_ROLE(?:_KEY)?\\s*[:=]\\s*[\"'`][^\"'`]{8,}", languageOf(file));
    const namedValue = namedService ? quotedValue(namedService.snippet) : null;
    if (namedService && namedValue && isClientPath(file.relativePath, file.text) && (jwtRole(namedValue) === "service_role" || looksLikeRealSecret(namedValue))) {
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
      languageOf(file),
    );
    const publicValue = publicVar ? quotedValue(publicVar.snippet) : null;
    if (publicVar && publicValue && looksLikeRealSecret(publicValue)) {
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
      const secretLine = envSecretLine(file.text);
      if (secretLine) {
        findings.push(
          makeFinding({
            ruleId: "code_secret_env_file",
            family: "Secrets",
            file: file.relativePath,
            line: secretLine.line,
            snippet: secretLine.text,
            severity: "critical",
            title: "Environment file is committed",
            explanation: "An env file in the repository holds a live-looking value. Deleting the file later does not remove it from history.",
            owasp: "A02:2021",
            fixPrompt: promptFor(file.relativePath, secretLine.line, "An env file with a secret is tracked.", "Remove it from the tree and from git history, add it to the ignore file, and rotate every value that was committed."),
          }),
        );
      }
    }
  }
  return dedupe(findings);
}

function envSecretLine(text: string): { line: number; text: string } | null {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const name = match[1];
    if (!/(SECRET|PASSWORD|TOKEN|PRIVATE|API_KEY|DATABASE_URL|REDIS_URL)/i.test(name)) continue;
    const raw = match[2].trim().replace(/^["']|["']$/g, "");
    if (findAcceptedSecrets(raw).length > 0 || connectionSecret(raw) || looksLikeRealSecret(raw)) {
      return { line: index + 1, text: line };
    }
  }
  return null;
}

function connectionSecret(value: string): boolean {
  const userinfo = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/\s]+)@/i);
  if (!userinfo) return false;
  const password = decodeURIComponent(userinfo[1].split(":").slice(1).join(":"));
  return looksLikeRealSecret(password);
}

function historyLineIsSecret(lineText: string): boolean {
  if (findAcceptedSecrets(lineText).length > 0) return true;
  return /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/.test(lineText) && jwtRole(lineText.match(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/)?.[0] ?? "") === "service_role";
}

function historyRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  const seen = new Set<string>();
  for (const hit of repo.history) {
    const env = isHistoryEnv(hit.path);
    const secret = !env && historyLineIsSecret(hit.lineText);
    if (!env && !secret) continue;
    if (env && hit.lineText !== "env file committed" && !historyLineIsSecret(hit.lineText) && !envSecretLine(`${hit.lineText}\n`)) continue;
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
    const hasAuth = reachableSignal(file, repo, `${AUTH_SIGNAL}|${SIGNATURE_SIGNAL}`);
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
    if (isAdminRoute(file.relativePath) && !reachableSignal(file, repo, ROLE_SIGNAL)) {
      const place = firstMatch(file.text, "export\\s+(?:async\\s+)?function\\s+(?:GET|POST|PUT|PATCH|DELETE)|export\\s+const\\s+(?:GET|POST)", languageOf(file));
      findings.push(
        makeFinding({
          ruleId: "code_access_admin",
          family: "Access control",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? file.relativePath,
          severity: "critical",
          title: "Admin route has no role check",
          explanation: "This route lives under an admin path and the file does not check an admin role. Any caller who can hit the URL can use it.",
          owasp: "A01:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "The admin route does not check a role.", "Require a signed-in admin on the server and return 403 for everyone else."),
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
    const concat = sqlConcatenation(file);
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

function sqlConcatenation(file: SourceFile): { line: number; snippet: string } | null {
  const language = languageOf(file);
  const userInput = /(?:\$\{\s*(?:req|request|body|params|query|input|user|searchParams|user_id)\b|["'`]\s*\+\s*(?:req|request|body|params|query|input|user|searchParams|user_id)\b)/;
  for (const match of file.text.matchAll(/\b(?:select|insert|update|delete)\b/gi)) {
    const index = match.index ?? 0;
    if (regionAt(file.text, index, language) !== "string") continue;
    const after = file.text.slice(index + match[0].length, index + match[0].length + 1);
    if (after === "(") continue;
    const window = file.text.slice(index, index + 240);
    if (!userInput.test(window)) continue;
    const line = lineAt(file.text, index);
    return { line, snippet: lineText(file.text, line) };
  }
  return null;
}

function injectionRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  for (const file of repo.javascript) {
    const html = unsafeHtml(file);
    if (html) {
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
    const evaluated = codeCall(file, "(?<![\\w.])eval\\s*\\(|(?<![\\w.])new\\s+Function\\s*\\(");
    if (evaluated && !/eval\s*\(\s*["'`][^"'`]*["'`]/.test(evaluated.snippet) && !/new\s+Function\s*\(\s*["'`]/.test(evaluated.snippet)) {
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
    const command = unsafeCommand(file);
    if (command) {
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
    const fetchHit = codeCall(file, "fetch\\s*\\(\\s*(?:req\\.|request\\.|searchParams|params\\.|body\\.|`[^`]*\\$\\{[^}]*(?:req|searchParams|params|body|user|input))");
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
    const redirect = codeCall(file, "(?:redirect|res\\.redirect)\\s*\\(\\s*(?:searchParams|req\\.query|req\\.body|params\\.|next\\b|destination)");
    if (redirect && regionAt(file.text, redirect.index, "javascript") === "code") {
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
    const upload = unsafeUpload(file);
    if (upload) {
      findings.push(
        makeFinding({
          ruleId: "code_inject_upload",
          family: "Injection and output",
          file: file.relativePath,
          line: upload.line,
          snippet: upload.snippet,
          severity: "medium",
          title: "Upload is saved without a type or size check",
          explanation: "The handler writes an uploaded file and does not check the type or size. That can store unexpected content.",
          owasp: "A04:2021",
          fixPrompt: promptFor(file.relativePath, upload.line, "The upload is not validated.", "Allow only expected types, reject large files, and store them outside the public web root."),
        }),
      );
    }
  }
  return dedupe(findings);
}

function codeCall(file: SourceFile, source: string): { index: number; line: number; snippet: string; value: string } | null {
  for (const hit of eachMatch(file.text, source, languageOf(file))) {
    if (regionAt(file.text, hit.index, languageOf(file)) !== "code") continue;
    if (lineHasRegexSource(hit.snippet)) continue;
    return hit;
  }
  return null;
}

const HTML_VALUE = /\b(?:props|params|user|html|content|message|children|input|query|body|markdown|raw|location|hash)\b/i;

function unsafeHtml(file: SourceFile): { line: number; snippet: string } | null {
  const expression = /dangerouslySetInnerHTML\s*=\s*\{\{[^}]*__html\s*:\s*([^}\n]+)\}|\.innerHTML\s*=\s*([^;\n]+)/g;
  for (const match of file.text.matchAll(expression)) {
    const index = match.index ?? 0;
    if (regionAt(file.text, index, "javascript") !== "code") continue;
    const line = lineText(file.text, lineAt(file.text, index));
    if (lineHasRegexSource(line)) continue;
    const value = (match[1] || match[2] || "").trim();
    if (!value || /^["'`]/.test(value)) continue;
    if (/JSON\.stringify|escapeHtml|sanitize|DOMPurify/.test(value)) continue;
    const ident = /^[A-Za-z_$][\w$]*/.exec(value)?.[0];
    if (ident) {
      const declaration = new RegExp(`(?:const|let|var)\\s+${ident}\\s*=\\s*([^\\n;]+)`).exec(file.text);
      if (declaration && /JSON\.stringify|escapeHtml|sanitize|DOMPurify/.test(declaration[1])) continue;
    }
    if (!HTML_VALUE.test(value)) continue;
    return { line: lineAt(file.text, index), snippet: line };
  }
  return null;
}

function unsafeCommand(file: SourceFile): { line: number; snippet: string } | null {
  for (const hit of eachMatch(file.text, "(?<![\\w.])(?:execSync|exec|spawnSync|spawn)\\s*\\(", languageOf(file))) {
    if (regionAt(file.text, hit.index, languageOf(file)) !== "code") continue;
    if (lineHasRegexSource(hit.snippet)) continue;
    const window = file.text.slice(hit.index, hit.index + 360);
    const call = /^(execSync|exec|spawnSync|spawn)\s*\(/.exec(window);
    if (!call) continue;
    const name = call[1];
    const rest = window.slice(call[0].length);
    if (/shell\s*:\s*true/.test(window) && name.startsWith("spawn")) {
      return { line: hit.line, snippet: hit.snippet };
    }
    if (/^\s*["'][^"'\n]+["']\s*[,)]/.test(rest)) continue;
    if (name.startsWith("spawn") && /^\s*(?:["'][^"'\n]+["']|process\.execPath|process\.argv\[0\])\s*,\s*\[/.test(rest)) continue;
    if (name === "exec" || name === "execSync") return { line: hit.line, snippet: hit.snippet };
    if (name.startsWith("spawn") && !/^\s*(?:["']|process\.execPath|process\.argv\[0\])/.test(rest)) {
      return { line: hit.line, snippet: hit.snippet };
    }
  }
  return null;
}

function unsafeUpload(file: SourceFile): { line: number; snippet: string } | null {
  for (const hit of eachMatch(file.text, "\\b(?:writeFileSync|writeFile|putObject)\\s*\\(", languageOf(file))) {
    if (regionAt(file.text, hit.index, languageOf(file)) !== "code") continue;
    const window = file.text.slice(Math.max(0, hit.index - 500), hit.index + 500);
    if (!/formData|req\.file|multer/.test(window)) continue;
    if (/mimetype|mime|content-type|allowedTypes|fileFilter|maxSize|file\.size/i.test(window)) continue;
    return { line: hit.line, snippet: hit.snippet };
  }
  return null;
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
    const headerNames = /content-security-policy|Content-Security-Policy|X-Frame-Options|strict-transport-security/i;
    const headersInMiddleware = repo.files.some((item) => /(?:^|\/)middleware\.[cm]?[jt]sx?$/.test(item.relativePath) && headerNames.test(item.text));
    if (/^next\.config\./.test(file.relativePath.split("/").pop() ?? "") && !headerNames.test(file.text) && !/headers\s*\(/.test(file.text) && !headersInMiddleware) {
      const place = firstMatch(file.text, "const\\s+nextConfig|module\\.exports|export\\s+default", languageOf(file));
      findings.push(
        makeFinding({
          ruleId: "code_config_headers",
          family: "Configuration",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet || lineText(file.text, 1) || "next config",
          severity: "low",
          title: "Security headers are not set in the app config",
          explanation: "The Next config does not set a content security policy, frame protection, or strict transport security. Browsers will not get those protections from this file.",
          owasp: "A05:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "Security headers are missing from the app config.", "Add headers for Content-Security-Policy, X-Frame-Options, and Strict-Transport-Security."),
        }),
      );
    }
    const stack = nearResponse(file, "\\.stack\\b", "NextResponse\\.json|res\\.json|res\\.send");
    if (stack) {
      const place = stack;
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
    if (isAuthRoute(file.relativePath) && HANDLER.test(file.text) && !reachableSignal(file, repo, RATE_SIGNAL)) {
      const place = firstMatch(file.text, "export\\s+(?:async\\s+)?function\\s+(?:GET|POST|PUT|PATCH|DELETE)|export\\s+const\\s+(?:GET|POST)", languageOf(file));
      findings.push(
        makeFinding({
          ruleId: "code_config_rate_limit",
          family: "Configuration",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? file.relativePath,
          severity: "medium",
          title: "Auth route has no rate limit",
          explanation: "This login or signup route does not limit how often it can be called. Attackers can guess passwords or create accounts without a delay.",
          owasp: "A07:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "The auth route is not rate limited.", "Limit attempts per IP and per account, and return 429 when the limit is hit."),
        }),
      );
    }
    const cookie = nearResponse(file, "httpOnly\\s*:\\s*false|secure\\s*:\\s*false|sameSite\\s*:\\s*[\"']none[\"']", "cookie|setCookie|cookies\\(");
    if (cookie) {
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
    const weakHash = nearResponse(file, "createHash\\(\\s*[\"'](?:md5|sha1)[\"']\\)", "password");
    if (weakHash) {
      const place = weakHash;
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

function nearResponse(file: SourceFile, left: string, right: string): { line: number; snippet: string } | null {
  const language = languageOf(file);
  for (const hit of eachMatch(file.text, left, language)) {
    if (regionAt(file.text, hit.index, language) === "comment") continue;
    const window = file.text.slice(Math.max(0, hit.index - 350), hit.index + 350);
    if (!new RegExp(right, "i").test(window)) continue;
    return { line: hit.line, snippet: hit.snippet };
  }
  return null;
}

function paymentRule(repo: RepoFacts): CodeFinding[] {
  const findings: CodeFinding[] = [];
  for (const file of repo.javascript) {
    const paymentWords = hasCodeSignal(file.text, "stripe|payment|dodo|checkout", languageOf(file));
    if (isApiRoute(file.relativePath) && /webhook/i.test(file.relativePath) && paymentWords && !reachesSignatureVerification(file, repo.files)) {
      const place = firstMatch(file.text, "export\\s+(?:async\\s+)?function\\s+(?:GET|POST|PUT|PATCH|DELETE)|export\\s+const\\s+(?:GET|POST)", languageOf(file));
      findings.push(
        makeFinding({
          ruleId: "code_pay_webhook",
          family: "Payments",
          file: file.relativePath,
          line: place?.line ?? 1,
          snippet: place?.snippet ?? file.relativePath,
          severity: "critical",
          title: "Payment webhook does not check a signature",
          explanation: "This webhook handler talks about a payment and does not verify the provider signature. Anyone can post a fake paid event.",
          owasp: "A08:2021",
          fixPrompt: promptFor(file.relativePath, place?.line ?? 1, "The webhook body is trusted without a signature.", "Verify the provider signature with the webhook secret before changing an order."),
        }),
      );
    }
    const clientPrice = codeCall(file, "body\\.(?:amount|price|paid)\\b|(?:amount|price|paid)\\s*:\\s*(?:body|req\\.body|payload)\\.");
    const verifiedHere = hasCodeSignal(file.text, "constructEvent|stripe-signature", languageOf(file));
    if (clientPrice && paymentWords && !verifiedHere) {
      findings.push(
        makeFinding({
          ruleId: "code_pay_client_price",
          family: "Payments",
          file: file.relativePath,
          line: clientPrice.line,
          snippet: clientPrice.snippet,
          severity: "critical",
          title: "Price or paid status comes from the client",
          explanation: "The handler trusts an amount or paid flag sent by the browser. A caller can change the price or mark an order paid.",
          owasp: "A04:2021",
          fixPrompt: promptFor(file.relativePath, clientPrice.line, "The client supplies the price or paid flag.", "Look up the price on the server and set paid only after a verified payment event."),
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
      const index = match.index ?? 0;
      if (regionAt(file.text, index, languageOf(file)) !== "code") continue;
      const args = match[1] ?? "";
      const stripped = args.replace(/["'`][^"'`]*["'`]/g, "");
      if (!/\b(?:password|secret|api[_-]?key|token|prompt|email|ssn)\b/i.test(stripped)) continue;
      const line = lineAt(file.text, index);
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
    const callsModel = hasCodeSignal(file.text, "openai|anthropic|generateText|chat\\.completions|GoogleGenerativeAI|new Groq|messages\\.create", languageOf(file));
    const aiRoute = isApiRoute(file.relativePath) && (/\/api\/(?:chat|ai|generate|completions|openai|anthropic)\//.test(file.relativePath) || callsModel);
    const handler = firstMatch(file.text, "export\\s+(?:async\\s+)?function\\s+(?:GET|POST|PUT|PATCH|DELETE)|export\\s+const\\s+(?:GET|POST)", languageOf(file));
    if (aiRoute && callsModel && !reachableSignal(file, repo, AUTH_SIGNAL)) {
      findings.push(
        makeFinding({
          ruleId: "code_ai_endpoint_auth",
          family: "AI security",
          file: file.relativePath,
          line: handler?.line ?? 1,
          snippet: handler?.snippet ?? file.relativePath,
          severity: "high",
          title: "AI endpoint does not check who is calling",
          explanation: "This route calls a model and does not check a session. Anyone who can reach the URL can spend your model budget.",
          owasp: "A01:2021",
          fixPrompt: promptFor(file.relativePath, handler?.line ?? 1, "The model route has no auth check.", "Require a session before calling the model and reject anonymous requests."),
        }),
      );
    }
    if (aiRoute && callsModel && !reachableSignal(file, repo, `${RATE_SIGNAL}|spend|budget|maxSpend`)) {
      findings.push(
        makeFinding({
          ruleId: "code_ai_endpoint_limit",
          family: "AI security",
          file: file.relativePath,
          line: handler?.line ?? 1,
          snippet: handler?.snippet ?? file.relativePath,
          severity: "medium",
          title: "AI endpoint has no rate limit or spend cap",
          explanation: "The route can call a model without a per-user limit or a spend cap. A loop of requests can run up the bill.",
          owasp: "A04:2021",
          fixPrompt: promptFor(file.relativePath, handler?.line ?? 1, "The model route has no limit.", "Add a per-user rate limit and a daily spend cap before the provider is called."),
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
    const promptSecret = promptContainsSecret(file);
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
    const sink = codeCall(file, "dangerouslySetInnerHTML[\\s\\S]{0,120}(?:completion|message\\.content|choices)|(?<![\\w.])eval\\s*\\([^)]*(?:completion|llm|choices)|(?:exec|queryRawUnsafe|query)\\s*\\([^)]*(?:completion|llmOutput|modelOutput)");
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
    const tools = firstMatch(file.text, "tools\\s*:\\s*\\[|functions\\s*:\\s*\\[", languageOf(file));
    if (tools && !lineHasRegexSource(tools.snippet) && regionAt(file.text, tools.index, languageOf(file)) === "code") {
      const around = file.text.slice(Math.max(0, tools.index - 200), tools.index + 400);
      if (/delete|drop|transfer|refund|charge/i.test(around) && !/confirm|allowlist|allowedTools/i.test(around)) {
        findings.push(
          makeFinding({
            ruleId: "code_ai_tool_unconfirmed",
            family: "AI security",
            file: file.relativePath,
            line: tools.line,
            snippet: tools.snippet,
            severity: "high",
            title: "Model tools can take a destructive action without a check",
            explanation: "The model can call a tool that deletes, transfers, refunds, or charges, and the file has no confirmation step or allow-list.",
            owasp: "A04:2021",
            fixPrompt: promptFor(file.relativePath, tools.line, "A model tool can change or destroy data on its own.", "Allow only named tools and require a person to confirm destructive actions."),
          }),
        );
      }
    }
    const retrieval = firstMatch(file.text, "match_documents|similaritySearch|vectorSearch|\\.rpc\\(\\s*[\"']match", languageOf(file));
    if (retrieval && !lineHasRegexSource(retrieval.snippet) && regionAt(file.text, retrieval.index, languageOf(file)) !== "comment" && !/user_id|tenant|owner_id|ownerId/.test(file.text.slice(Math.max(0, retrieval.index - 200), retrieval.index + 300))) {
      const place = retrieval;
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
    const gemini = /gemini|generativelanguage/i.test(file.text) ? acceptedGemini(file) : null;
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

function promptContainsSecret(file: SourceFile): { line: number; snippet: string } | null {
  for (const marker of eachMatch(file.text, "systemPrompt|role\\s*:\\s*[\"']system[\"']", languageOf(file))) {
    if (lineHasRegexSource(marker.snippet)) continue;
    const window = file.text.slice(marker.index, marker.index + 500);
    const secrets = findAcceptedSecrets(window).filter((secret) => secretOnLine(file, marker.index + secret.index, secret.value.length));
    if (secrets.length === 0) continue;
    return { line: marker.line, snippet: marker.snippet };
  }
  return null;
}

function acceptedGemini(file: SourceFile): { line: number; snippet: string } | null {
  for (const hit of eachMatch(file.text, "\\bAIza[0-9A-Za-z_-]{35,}", languageOf(file))) {
    const body = hit.value.slice(4);
    if (body.length < 35 || !looksLikeRealSecret(body)) continue;
    return { line: hit.line, snippet: hit.snippet };
  }
  return null;
}

function dedupe(findings: CodeFinding[]): CodeFinding[] {
  const seen = new Set<string>();
  const unique: CodeFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.ruleId}:${finding.file}:${finding.line}:${finding.snippet}`;
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
