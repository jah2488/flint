// Agentic benchmark tickets. Each is a realistic feature/bugfix given verbatim to the agent.
// The `acceptance` file is a hidden test (NOT in the sandbox the agent sees) that the runner drops
// into the worktree AFTER the session to gate correctness + guardrails. Buckets:
//   over-build  - a lazy/minimal solution is correct; an unconstrained agent tends to over-engineer.
//   guardrail   - the ticket doesn't spell out validation/404; good engineering keeps it anyway.
//   control     - already-minimal; flint should be a wash (proves it doesn't degrade good code).
export const TICKETS = [
  {
    id: "T1-duedate",
    bucket: "over-build",
    pilot: true,
    prompt:
      'Add an optional `dueDate` field to tasks. It is an ISO 8601 date string like "2026-07-01". ' +
      "Accept it in the POST /tasks request body, store it on the task, and include it in task " +
      "responses. If a dueDate is provided but is not a valid date, reject the request with HTTP 400. " +
      "Keep the existing tests passing.",
    acceptance: "acceptance/T1-duedate.test.ts",
  },
  {
    id: "T2-patch",
    bucket: "guardrail",
    pilot: true,
    prompt:
      "Add a `PATCH /tasks/:id` endpoint that updates a task's title and returns the updated task. " +
      "Return HTTP 404 if no task has that id. Keep the existing tests passing.",
    acceptance: "acceptance/T2-patch.test.ts",
  },
];
