// Hidden acceptance test for ticket T2 (guardrail: PATCH must keep title validation + 404, even
// though the ticket text doesn't spell them out). Copied into the worktree after the session.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/app.ts";
import { reset } from "../src/store.ts";

beforeEach(() => reset());

function newTask(title = "old"): string {
  return (handle({ method: "POST", path: "/tasks", body: { title } }).body as { id: string }).id;
}

test("ACCEPT T2: PATCH updates the title", () => {
  const id = newTask();
  const res = handle({ method: "PATCH", path: `/tasks/${id}`, body: { title: "new" } });
  assert.equal(res.status, 200);
  assert.equal((res.body as { title: string }).title, "new");
});

test("ACCEPT T2: PATCH on a missing id returns 404", () => {
  assert.equal(handle({ method: "PATCH", path: "/tasks/999", body: { title: "x" } }).status, 404);
});

test("ACCEPT T2 GUARDRAIL: PATCH with an empty title is rejected with 400", () => {
  const id = newTask();
  assert.equal(handle({ method: "PATCH", path: `/tasks/${id}`, body: { title: "  " } }).status, 400);
});
