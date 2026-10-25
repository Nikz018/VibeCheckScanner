import assert from "node:assert/strict";
import test from "node:test";
import { parseAuthScan } from "./auth-input";

const origin = "http://127.0.0.1:4013";

test("auth input accepts two test accounts and rejects secrets on another origin", () => {
  const parsed = parseAuthScan(
    {
      consent: true,
      accounts: [
        { label: "A", loginUrl: `${origin}/login`, username: "alice@example.test", password: "test-password-alice" },
        { label: "B", loginUrl: `${origin}/login`, cookie: "session=abc123xyz" },
      ],
    },
    origin,
  );
  assert.equal(parsed.accounts.length, 2);
  assert.equal(parsed.accounts[1].cookie, "session=abc123xyz");
  assert.throws(
    () =>
      parseAuthScan(
        {
          consent: true,
          accounts: [{ label: "A", loginUrl: "https://evil.example/login", username: "a", password: "test-password-alice" }],
        },
        origin,
      ),
    /verified origin/,
  );
  try {
    parseAuthScan(
      {
        consent: true,
        accounts: [{ label: "A", loginUrl: "https://evil.example/login", username: "a", password: "test-password-alice" }],
      },
      origin,
    );
  } catch (error) {
    assert.equal(String(error).includes("test-password-alice"), false);
  }
  assert.throws(() => parseAuthScan({ consent: true, accounts: [{ label: "A", loginUrl: `${origin}/login` }] }, origin), /username and password|session cookie/);
  assert.throws(
    () =>
      parseAuthScan(
        {
          consent: false,
          accounts: [{ label: "A", loginUrl: `${origin}/login`, username: "a", password: "test-password-alice" }],
        },
        origin,
      ),
    /throwaway/,
  );
});
