import assert from "node:assert/strict";
import test from "node:test";
import { workerConcurrency } from "./concurrency";

test("worker concurrency defaults to 1 and stays in range", () => {
  assert.equal(workerConcurrency(undefined), 1);
  assert.equal(workerConcurrency(""), 1);
  assert.equal(workerConcurrency("1"), 1);
  assert.equal(workerConcurrency("0"), 1);
  assert.equal(workerConcurrency("-3"), 1);
  assert.equal(workerConcurrency("1.5"), 1);
  assert.equal(workerConcurrency("nope"), 1);
  assert.equal(workerConcurrency("2"), 2);
  assert.equal(workerConcurrency("8"), 8);
  assert.equal(workerConcurrency("9"), 8);
});
