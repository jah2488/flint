// Functional core: a request goes in, a response comes out. No I/O here (server.ts owns that),
// so every route is trivially testable. Collect input -> do the work -> handle failure at the edges.
import * as store from "./store.ts";
import { requireTitle, ValidationError } from "./validate.ts";

export interface Req {
  method: string;
  path: string;
  body?: unknown;
}

export interface Res {
  status: number;
  body: unknown;
}

export function handle(req: Req): Res {
  try {
    if (req.method === "GET" && req.path === "/tasks") {
      return { status: 200, body: store.list() };
    }

    if (req.method === "POST" && req.path === "/tasks") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const title = requireTitle(body.title);
      return { status: 201, body: store.create({ title }) };
    }

    const match = req.path.match(/^\/tasks\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const task = store.get(match[1]);
      return task ? { status: 200, body: task } : { status: 404, body: { error: "task not found" } };
    }

    return { status: 404, body: { error: "not found" } };
  } catch (err) {
    if (err instanceof ValidationError) return { status: 400, body: { error: err.message } };
    return { status: 500, body: { error: "internal error" } };
  }
}
