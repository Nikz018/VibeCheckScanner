import assert from "node:assert/strict";
import test from "node:test";
import { locateSecretHits } from "./extract";

test("public JavaScript findings include model provider keys", () => {
  const hits = locateSecretHits([
    {
      url: "https://app.example/assets/chat.js",
      body: [
        'const anthropic = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";',
        'const groq = "gsk_abcdefghijklmnopqrstuvwxyz";',
        'const GEMINI_API_KEY = "AIzaSyabcdefghijklmnopqrstuvwxyz123456";',
      ].join("\n"),
    },
  ]);
  const kinds = hits.map((hit) => hit.kind);
  assert.ok(kinds.some((kind) => kind.includes("Anthropic")));
  assert.ok(kinds.some((kind) => kind.includes("Groq")));
  assert.ok(kinds.some((kind) => kind.includes("Gemini")));
  const blob = JSON.stringify(hits);
  assert.equal(blob.includes("sk-ant-api03-abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(blob.includes("gsk_abcdefghijklmnopqrstuvwxyz"), false);
});
