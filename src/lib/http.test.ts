import assert from "node:assert/strict";
import test from "node:test";
import { ProbeBlockedError, assertProbeAllowed, isPrivateAddress } from "./http";
import { proofMatches } from "./ownership";

test("private and link-local addresses are recognized", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.9", "172.16.0.4", "169.254.169.254", "::1", "fd00::1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("1.1.1.1"), false);
});

test("blocked hosts and non-http URLs are refused", async () => {
  await assert.rejects(() => assertProbeAllowed("http://169.254.169.254/latest", "http://169.254.169.254"), ProbeBlockedError);
  await assert.rejects(() => assertProbeAllowed("http://metadata.google.internal/", "http://metadata.google.internal"), ProbeBlockedError);
  await assert.rejects(() => assertProbeAllowed("file:///etc/passwd", "file:///etc/passwd"), ProbeBlockedError);
});

test("ownership file comparison ignores surrounding whitespace only", () => {
  const token = "vc_" + "ab".repeat(16);
  assert.equal(proofMatches(`\n${token}\n`, token), true);
  assert.equal(proofMatches(token.slice(0, -1) + "0", token), false);
  assert.equal(proofMatches("vc_short", token), false);
});
