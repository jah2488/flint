#!/usr/bin/env node
// Agentic A/B runner. For each (ticket, arm, rep): copy the sandbox to an isolated temp dir,
// git-commit a base, run a REAL Claude Code agentic session (tools on, in that dir), then measure
// the agent's diff and gate correctness with the hidden acceptance test. Arms:
//   baseline    - vanilla Claude Code (no skill)
//   flint       - same, with the flint SKILL appended to the system prompt (full intensity)
//   flint-lite / flint-ultra - flint with an intensity directive
// --setting-sources project keeps the operator's user-level CLAUDE.md and installed skills out, so
// baseline is clean and flint is applied ONLY via --append-system-prompt.
//
// Usage: node run-agentic.mjs [--tickets T1-duedate,T2-patch] [--arms baseline,flint] [--reps 3]
//                             [--model claude-haiku-4-5] [--concurrency 1] [--out snapshots/<f>.json]

import { execFileSync } from "node:child_process";
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TICKETS } from "./tickets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX = join(HERE, "sandbox");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const list = (n) => arg(n, "").split(",").map((s) => s.trim()).filter(Boolean);

const MODEL = arg("model", "claude-haiku-4-5");
const REPS = parseInt(arg("reps", "3"), 10);
const ARMS = list("arms").length ? list("arms") : ["baseline", "flint"];
const TICKET_FILTER = list("tickets");
const stamp = new Date().toISOString().slice(0, 10);
const OUT = arg("out", join(HERE, "snapshots", `agentic-${stamp}.json`));

const SKILL_BODY = readFileSync(join(HERE, "..", "..", "skills", "flint", "SKILL.md"), "utf8")
  .replace(/^---\n[\s\S]*?\n---\n/, "").trim();

function flintSystem(arm) {
  const dir = arm === "flint-lite" ? "\n\nActive intensity: LITE." : arm === "flint-ultra" ? "\n\nActive intensity: ULTRA." : "";
  return SKILL_BODY + dir;
}

function git(wt, ...a) { return execFileSync("git", ["-C", wt, ...a], { encoding: "utf8" }); }

function diffStat(wt) {
  git(wt, "add", "-A");
  const numstat = git(wt, "diff", "--cached", "--numstat").trim();
  const diffText = git(wt, "diff", "--cached").slice(0, 12000); // raw diff for the judge + provenance
  if (!numstat) return { diffLines: 0, files: 0, diffText: "" };
  let lines = 0; const files = new Set();
  for (const row of numstat.split("\n")) {
    const [add, del, path] = row.split("\t");
    if (add === "-") continue; // binary
    lines += (parseInt(add, 10) || 0) + (parseInt(del, 10) || 0);
    files.add(path);
  }
  return { diffLines: lines, files: files.size, diffText };
}

function runAcceptance(wt, acceptanceFile) {
  cpSync(join(HERE, acceptanceFile), join(wt, "test", "__acceptance.test.ts"));
  let out = "";
  try {
    out = execFileSync("node", ["--test"], { cwd: wt, timeout: 90_000, encoding: "utf8" });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "");
  }
  const pass = Number((out.match(/(?:ℹ|#)\s*pass\s+(\d+)/) || [])[1] ?? 0);
  const fail = Number((out.match(/(?:ℹ|#)\s*fail\s+(\d+)/) || [])[1] ?? 1);
  return { testsPass: fail === 0 && pass > 0, pass, fail };
}

function runCell(ticket, arm, rep) {
  const wt = mkdtempSync(join(tmpdir(), "flint-agentic-"));
  cpSync(SANDBOX, wt, { recursive: true });
  rmSync(join(wt, "node_modules"), { recursive: true, force: true });
  git(wt, "init", "-q"); git(wt, "add", "-A");
  execFileSync("git", ["-C", wt, "-c", "user.email=b@b", "-c", "user.name=b", "commit", "-qm", "base"], { encoding: "utf8" });

  const prompt =
    "You are working in a TypeScript task-API repo (zero dependencies; run the test suite with " +
    "`node --test`). Implement the following ticket by editing files in this repo. When finished, " +
    "make sure `node --test` passes.\n\nTICKET:\n" + ticket.prompt;
  const aArgs = ["-p", prompt, "--model", MODEL, "--output-format", "json",
    "--permission-mode", "bypassPermissions", "--allowedTools", "Edit", "Write", "Read", "Bash",
    "--setting-sources", "project", "--strict-mcp-config"];
  if (arm.startsWith("flint")) aArgs.push("--append-system-prompt", flintSystem(arm));

  let turns = null, otoks = null, err = null;
  try {
    const out = execFileSync("claude", aArgs, { cwd: wt, timeout: 420_000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
    const j = JSON.parse(out);
    turns = j.num_turns ?? null; otoks = j.usage?.output_tokens ?? null;
    if (j.is_error) err = "session is_error";
  } catch (e) {
    err = String(e.message || e).slice(0, 160);
  }

  const { diffLines, files, diffText } = diffStat(wt); // agent changes only (before acceptance copy)
  const { testsPass, pass, fail } = runAcceptance(wt, ticket.acceptance);
  rmSync(wt, { recursive: true, force: true });
  return { ticket: ticket.id, bucket: ticket.bucket, arm, rep, testsPass, pass, fail, diffLines, files, turns, otoks, err, diff: diffText };
}

function main() {
  const tickets = TICKET_FILTER.length ? TICKETS.filter((t) => TICKET_FILTER.includes(t.id)) : TICKETS;
  const cells = [];
  for (const t of tickets) for (const arm of ARMS) for (let r = 0; r < REPS; r++) cells.push({ t, arm, r });
  console.error(`agentic A/B: ${tickets.length} tickets x ${ARMS.length} arms x ${REPS} reps = ${cells.length} sessions, model=${MODEL}`);

  const records = [];
  let i = 0;
  for (const { t, arm, r } of cells) {
    process.stderr.write(`\r  ${++i}/${cells.length}  ${t.id}/${arm}#${r}            `);
    records.push(runCell(t, arm, r));
  }
  process.stderr.write("\n");

  writeFileSync(OUT, JSON.stringify({
    metadata: { generated_at: new Date().toISOString(), model: MODEL, reps: REPS, arms: ARMS,
      method: "real Claude Code agentic session per cell in an isolated copy of benchmarks/agentic/sandbox; diff = git numstat of the agent's changes; correctness gated by a hidden acceptance test. --setting-sources project + --strict-mcp-config; flint via --append-system-prompt." },
    records,
  }, null, 2));
  const ok = records.filter((x) => x.testsPass).length;
  console.error(`wrote ${records.length} records -> ${OUT}  (${ok}/${records.length} passed acceptance)`);
}
main();
