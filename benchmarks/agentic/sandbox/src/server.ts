// Imperative shell: the only file that touches the network. Parses the request, calls the pure
// core (app.handle), writes the response.
import { createServer } from "node:http";
import { handle } from "./app.ts";

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");

  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }

  const out = handle({ method: req.method ?? "GET", path: (req.url ?? "/").split("?")[0], body });
  res.writeHead(out.status, { "content-type": "application/json" });
  res.end(JSON.stringify(out.body));
});

server.listen(Number(process.env.PORT) || 3000);
