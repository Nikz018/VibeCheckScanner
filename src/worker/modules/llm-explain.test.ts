import assert from "node:assert/strict";
import test from "node:test";
import { clampTokens, CODE_SCAN_TOKEN_CAP, explainCodeFindings, PASSIVE_AI_METHODS } from "./llm";

const SECRET = "sk_live_abcdefghijklmnopqrstuv";

test("passive AI discovery uses OPTIONS and GET only", () => {
  assert.deepEqual([...PASSIVE_AI_METHODS], ["OPTIONS", "GET"]);
  assert.equal(PASSIVE_AI_METHODS.some((method) => method === "POST"), false);
});

test("explanations stay deterministic when no model key is set", async () => {
  const findings = [
    {
      ruleId: "code_secret_hardcoded",
      file: "src/keys.ts",
      line: 2,
      severity: "critical",
      title: "Secret is hardcoded",
      snippet: "const key = sk-redacted",
      explanation: "A key is in source.",
      fixPrompt: "Move it server-side.",
      owasp: "A02:2021",
    },
  ];
  const explained = await explainCodeFindings(findings, { apiKey: "" });
  assert.equal(explained[0]?.explanation, findings[0].explanation);
  assert.equal(clampTokens(50_000), CODE_SCAN_TOKEN_CAP);
});

test("explanation calls mask secrets and cap tokens", async () => {
  let sent = "";
  let maxTokens = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    sent = String(init?.body ?? "");
    maxTokens = JSON.parse(sent).max_tokens as number;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  ruleId: "code_ai_provider_key",
                  file: "app/api/chat/route.ts",
                  line: 4,
                  explanation: "The model key is in the route. Move it to the server.",
                  fixPrompt: "Rotate the key and read it from the server environment.",
                },
              ]),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const explained = await explainCodeFindings(
    [
      {
        ruleId: "code_ai_provider_key",
        file: "app/api/chat/route.ts",
        line: 4,
        severity: "critical",
        title: "Model provider key is in the repository",
        snippet: `const key = "${SECRET}"`,
        explanation: `Found ${SECRET} in the route.`,
        fixPrompt: "Remove it.",
        owasp: "A02:2021",
      },
    ],
    { apiKey: "test-key", fetchImpl, maxTokens: 9000 },
  );
  assert.equal(sent.includes(SECRET), false);
  assert.ok(maxTokens <= CODE_SCAN_TOKEN_CAP);
  assert.match(explained[0]?.explanation ?? "", /server/);
  assert.equal(explained[0]?.explanation.includes(SECRET), false);
});
