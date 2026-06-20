// Hidden acceptance test for ticket T1 (over-build: dueDate). The agent does not see this; the
// runner copies it into the worktree's test/ dir after the session and runs the full suite.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/app.ts";
import { reset } from "../src/store.ts";

beforeEach(() => reset());

test("ACCEPT T1: a valid dueDate is stored and returned", () => {
  const res = handle({ method: "POST", path: "/tasks", body: { title: "x", dueDate: "2026-07-01" } });
  assert.equal(res.status, 201);
  assert.equal((res.body as { dueDate?: string }).dueDate, "2026-07-01");
});

test("ACCEPT T1: dueDate is optional (POST without it still works)", () => {
  assert.equal(handle({ method: "POST", path: "/tasks", body: { title: "x" } }).status, 201);
});

test("ACCEPT T1: an invalid dueDate is rejected with 400", () => {
  assert.equal(handle({ method: "POST", path: "/tasks", body: { title: "x", dueDate: "not-a-date" } }).status, 400);
});
