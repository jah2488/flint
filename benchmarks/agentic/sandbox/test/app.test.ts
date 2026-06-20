import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/app.ts";
import { reset } from "../src/store.ts";

beforeEach(() => reset());

test("GET /tasks returns an empty list", () => {
  assert.deepEqual(handle({ method: "GET", path: "/tasks" }), { status: 200, body: [] });
});

test("POST /tasks creates a task", () => {
  const res = handle({ method: "POST", path: "/tasks", body: { title: "buy milk" } });
  assert.equal(res.status, 201);
  const task = res.body as { id: string; title: string; done: boolean };
  assert.equal(task.title, "buy milk");
  assert.equal(task.done, false);
  assert.ok(task.id);
});

test("POST /tasks rejects an empty title with 400", () => {
  assert.equal(handle({ method: "POST", path: "/tasks", body: { title: "  " } }).status, 400);
  assert.equal(handle({ method: "POST", path: "/tasks", body: {} }).status, 400);
});

test("GET /tasks/:id returns the task or 404", () => {
  const created = handle({ method: "POST", path: "/tasks", body: { title: "ship it" } }).body as { id: string };
  assert.equal(handle({ method: "GET", path: `/tasks/${created.id}` }).status, 200);
  assert.equal(handle({ method: "GET", path: "/tasks/nope" }).status, 404);
});
