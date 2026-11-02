import { reproduce } from "@/lib/finding-detail";
import { maskSecretsInText } from "@/lib/code-scan/mask";
import type { ProbeResponse } from "@/lib/http";
import { runModule, type ScanContext } from "../context";

export const LLM_CHECK_IDS = ["llm_endpoint_open", "llm_prompt_leak", "llm_missing_rate_limit"] as const;

/** Read-only discovery. These requests do not send a prompt and do not call a model. */
export const PASSIVE_AI_PATHS = ["/api/chat", "/api/ai", "/api/generate", "/api/completions", "/api/openai", "/api/anthropic"] as const;

export const PASSIVE_AI_METHODS = ["OPTIONS", "GET"] as const;

export const CODE_SCAN_TOKEN_CAP = 1200;

const REQUEST_HEADERS = { accept: "application/json" };

export async function runLlm(ctx: ScanContext): Promise<void> {
  await runModule([...LLM_CHECK_IDS], ctx, async () => {
    for (const id of LLM_CHECK_IDS) ctx.mark(id);
    for (const path of PASSIVE_AI_PATHS) {
      const options = await ctx.fetch(path, { method: "OPTIONS", follow: false, maxBytes: 20_000 });
      const get = await ctx.fetch(path, { method: "GET", follow: false, maxBytes: 80_000 });
      const response = openAiResponse(get) ?? openAiResponse(options);
      if (!response) continue;
      const method = response === get ? "GET" : "OPTIONS";
      ctx.add(
        "llm_endpoint_open",
        "An AI route returned a success status to a read-only request with no session cookie.",
        ctx.detailFor(response, {
          method,
          requestHeaders: REQUEST_HEADERS,
          steps: reproduce(method, response.url, `The route returned HTTP ${response.status} with no session cookie.`, "Require a session before calling the model."),
        }),
      );
      if (/system prompt/i.test(response.body)) {
        ctx.add(
          "llm_prompt_leak",
          "An AI route included hidden instruction text in a read-only response. The text was not copied into this report.",
          ctx.detailFor(
            { ...response, body: "[hidden instruction text omitted]" },
            {
              method,
              requestHeaders: REQUEST_HEADERS,
              steps: reproduce(method, response.url, "The response referred to hidden instructions. The instruction text was not stored.", "Keep secrets out of the prompt and refuse to return it."),
            },
          ),
        );
      }
      const limited = Object.keys(response.headers).some((key) => key.includes("ratelimit") || key.includes("rate-limit"));
      if (!limited && response.status !== 429) {
        ctx.add(
          "llm_missing_rate_limit",
          "An AI route answered a read-only request and did not return a rate-limit header.",
          ctx.detailFor(response, {
            method,
            requestHeaders: REQUEST_HEADERS,
            steps: reproduce(method, response.url, "The success response did not include a rate-limit header.", "Limit the route per user and per IP."),
          }),
        );
      }
    }
  });
}

function openAiResponse(response: ProbeResponse): ProbeResponse | null {
  if (response.status < 200 || response.status >= 300) return null;
  if (!response.body.trim()) return null;
  if ((response.headers["content-type"] || "").includes("text/html")) return null;
  return response;
}

export interface ExplainableFinding {
  ruleId: string;
  file: string;
  line: number;
  severity: string;
  title: string;
  snippet: string;
  explanation: string;
  fixPrompt: string;
  owasp: string;
}

/**
 * Rewrites explanations and fix prompts for a paid code scan.
 * Detection has already happened. The model never receives a raw secret.
 * Returns the original findings when no key is configured or the call fails.
 */
export async function explainCodeFindings<T extends ExplainableFinding>(
  findings: T[],
  options: {
    fetchImpl?: typeof fetch;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    maxTokens?: number;
  } = {},
): Promise<T[]> {
  if (findings.length === 0) return findings;
  const apiKey = (options.apiKey ?? process.env.CODE_SCAN_LLM_API_KEY ?? "").trim();
  if (!apiKey) return findings;
  const maxTokens = clampTokens(options.maxTokens ?? Number(process.env.CODE_SCAN_LLM_MAX_TOKENS || CODE_SCAN_TOKEN_CAP));
  const payload = findings.slice(0, 40).map((finding) => ({
    ruleId: finding.ruleId,
    file: finding.file,
    line: finding.line,
    severity: finding.severity,
    title: finding.title,
    owasp: finding.owasp,
    snippet: maskSecretsInText(finding.snippet).slice(0, 120),
    explanation: maskSecretsInText(finding.explanation).slice(0, 400),
    fixPrompt: maskSecretsInText(finding.fixPrompt).slice(0, 500),
  }));
  const base = (options.baseUrl || process.env.CODE_SCAN_LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = options.model || process.env.CODE_SCAN_LLM_MODEL || "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          {
            role: "system",
            content:
              "You rewrite security findings into plain English and a short fix prompt a person can paste into an editor. Keep the same file and line. Do not claim a certification or an audit. Do not name scanning products. Never invent a secret. Return a JSON array of objects with ruleId, file, line, explanation, and fixPrompt.",
          },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return findings;
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? "";
    const parsed = parseExplanation(content);
    if (!parsed) return findings;
    return findings.map((finding) => {
      const match = parsed.find((item) => item.ruleId === finding.ruleId && item.file === finding.file && item.line === finding.line);
      if (!match) return finding;
      return {
        ...finding,
        explanation: maskSecretsInText(match.explanation).slice(0, 700),
        fixPrompt: maskSecretsInText(match.fixPrompt).slice(0, 1200),
      };
    });
  } catch {
    return findings;
  } finally {
    clearTimeout(timer);
  }
}

export function clampTokens(value: number): number {
  if (!Number.isFinite(value) || value < 1) return CODE_SCAN_TOKEN_CAP;
  return Math.min(CODE_SCAN_TOKEN_CAP, Math.floor(value));
}

function parseExplanation(content: string): Array<{ ruleId: string; file: string; line: number; explanation: string; fixPrompt: string }> | null {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return null;
    const rows: Array<{ ruleId: string; file: string; line: number; explanation: string; fixPrompt: string }> = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (typeof record.ruleId !== "string" || typeof record.file !== "string" || typeof record.line !== "number") continue;
      if (typeof record.explanation !== "string" || typeof record.fixPrompt !== "string") continue;
      if (!record.explanation.trim() || !record.fixPrompt.trim()) continue;
      rows.push({
        ruleId: record.ruleId,
        file: record.file,
        line: record.line,
        explanation: record.explanation,
        fixPrompt: record.fixPrompt,
      });
    }
    return rows;
  } catch {
    return null;
  }
}
