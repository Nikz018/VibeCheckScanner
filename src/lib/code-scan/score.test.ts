import assert from "node:assert/strict";
import test from "node:test";
import { CHECK_CATALOG } from "@/lib/catalog";
import { renderPrintHtml } from "@/lib/download";
import { buildCustomerReport } from "@/lib/report";
import { computeScore } from "@/lib/score";
import { combinedScores, computeCodeScore, computeOverallScore, HIGH_CONFIDENCE_RULES, LOW_CONFIDENCE_PENALTY_FACTOR, OVERALL_SCORE_WEIGHTS, overallScoreExplanation } from "./score";

test("code score uses site weights and halves low-confidence pattern findings", () => {
  assert.equal(computeCodeScore([]), 100);
  assert.equal(computeCodeScore([{ severity: "critical", ruleId: "code_secret_hardcoded" }]), computeScore([{ severity: "critical" }]));
  assert.equal(computeCodeScore([{ severity: "critical", ruleId: "code_access_no_auth" }]), 88);
  assert.equal(computeCodeScore([{ severity: "high", ruleId: "code_access_idor" }]), 94);
  assert.equal(computeCodeScore([{ severity: "low", ruleId: "code_config_headers" }]), 99);
  assert.equal(
    computeCodeScore([
      { severity: "critical", ruleId: "code_secret_hardcoded" },
      { severity: "critical", ruleId: "code_secret_env_file" },
      { severity: "critical", ruleId: "code_ai_provider_key" },
      { severity: "critical", ruleId: "code_pay_webhook" },
    ]),
    0,
  );
  assert.equal(HIGH_CONFIDENCE_RULES.has("code_dependency_advisory"), true);
  assert.equal(HIGH_CONFIDENCE_RULES.has("code_ai_no_max_tokens"), false);
  assert.equal(LOW_CONFIDENCE_PENALTY_FACTOR, 0.5);
});

test("overall score is the documented weighted average", () => {
  assert.equal(OVERALL_SCORE_WEIGHTS.site + OVERALL_SCORE_WEIGHTS.code, 1);
  assert.equal(computeOverallScore(100, 100), 100);
  assert.equal(computeOverallScore(0, 100), 40);
  assert.equal(computeOverallScore(80, 50), 68);
  assert.equal(computeOverallScore(100, 0), 60);
  const note = overallScoreExplanation();
  assert.match(note, /60% the live site score/);
  assert.match(note, /40% the code score/);
  assert.match(note, /50% of those points/);
});

test("combined scores appear only for a finished $99 code scan", () => {
  const findings = [{ ruleId: "code_secret_hardcoded", family: "Secrets" as const, file: "a.ts", line: 1, snippet: "", severity: "critical" as const, title: "Secret", explanation: "A key is in source.", owasp: "A02:2021" as const, fixPrompt: "Remove it." }];
  const completed = { status: "completed" as const, findings };
  assert.deepEqual(combinedScores({ codeScanEnabled: true, siteScore: 80, codeReport: completed }), {
    site: 80,
    code: 75,
    overall: 78,
  });
  assert.equal(combinedScores({ codeScanEnabled: false, siteScore: 80, codeReport: completed }), null);
  assert.equal(combinedScores({ codeScanEnabled: true, siteScore: null, codeReport: completed }), null);
  assert.equal(combinedScores({ codeScanEnabled: true, siteScore: 80, codeReport: { status: "queued", findings } }), null);
  assert.equal(combinedScores({ codeScanEnabled: true, siteScore: 80, codeReport: null }), null);
});

test("the PDF cover shows three rings only when a code score exists", () => {
  const marked = Object.fromEntries(CHECK_CATALOG.map((check) => [check.id, "ok" as const]));
  const report = buildCustomerReport({
    scanId: "scan-1",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: new Date("2026-10-25T03:00:00.000Z"),
    marked,
    unlock: true,
    results: [],
  });
  const plain = renderPrintHtml(report, "http://127.0.0.1:4010");
  assert.equal(plain.match(/data-score-gauge=/g)?.length, 1);
  assert.equal(plain.includes("Overall"), false);

  const withCode = renderPrintHtml(report, "http://127.0.0.1:4010", { site: 80, code: 75, overall: 78 });
  assert.equal(withCode.match(/data-score-gauge=/g)?.length, 3);
  assert.match(withCode, /data-score-role="site"/);
  assert.match(withCode, /data-score-role="code"/);
  assert.match(withCode, /data-score-role="overall"/);
  assert.match(withCode, /data-score-gauge="80"/);
  assert.match(withCode, /data-score-gauge="75"/);
  assert.match(withCode, /data-score-gauge="78"/);
  assert.match(withCode, /60% the live site score/);
  assert.match(withCode, />80\/100</);
  assert.match(withCode, />78\/100</);
});
