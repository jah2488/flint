#!/usr/bin/env node
// Scoring + aggregation. Reads a snapshot of raw model outputs (from run.mjs) and
// recomputes every derived metric from that raw text, LOC, correctness (by actually
// executing the extracted code), keyword fidelity, native-feature use, then prints a
// markdown report with medians per cell. Nothing here re-queries the model, so the
// numbers always reconcile from the on-disk source.
//
// Usage: node measure.mjs [snapshots/results-<date>.json]   (defaults to newest snapshot)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { TASKS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));

function newestSnapshot() {
  const dir = join(HERE, "snapshots");
  const files = readdirSync(dir).filter((f) => f.startsWith("results-") && f.endsWith(".json"));
  if (!files.length) throw new Error("no snapshot in benchmarks/snapshots/");
  files.sort();
  return join(dir, files[files.length - 1]);
}

const SNAP = process.argv[2] || newestSnapshot();
const snapshot = JSON.parse(readFileSync(SNAP, "utf8"));

// ---- raw-text metrics -------------------------------------------------------
function codeBlocks(text) {
  const out = [];
  const re = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ lang: m[1].toLowerCase(), code: m[2] });
  return out;
}

function loc(text) {
  // ponytail's metric: non-empty lines inside fenced code blocks.
  return codeBlocks(text)
    .map((b) => b.code.split("\n").filter((l) => l.trim()).length)
    .reduce((a, b) => a + b, 0);
}

// Candidate code snippets to try, most-specific first: each matching block on its own, then all
// of them joined. Correctness passes if ANY candidate works, so an answer that gives a working
// stdlib version PLUS an unrunnable extra (e.g. a pandas alternative that isn't installed) still
// counts as correct. Over-offering like that is captured by LOC, not mislabeled as "incorrect".
function candidateCodes(text, lang) {
  const blocks = codeBlocks(text);
  const langs = lang === "js" ? ["js", "javascript", "jsx", "ts", "typescript", ""] : [lang, ""];
  const matching = (blocks.filter((b) => langs.includes(b.lang)).length
    ? blocks.filter((b) => langs.includes(b.lang))
    : blocks
  ).map((b) => b.code);
  const cands = matching.length > 1 ? [...matching, matching.join("\n\n")] : matching;
  const prep = lang === "js" ? sanitizeJs : (c) => c;
  return cands.map(prep).filter((c) => c.trim());
}

function sanitizeJs(code) {
  return code
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+/gm, "")
    .replace(/^\s*module\.exports\s*=.*$/gm, "")
    .replace(/^\s*import\s+.*$/gm, "");
}

function tmpFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), "flintbench-"));
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

function jsLiteral(v) {
  return JSON.stringify(v);
}

function jsHarness(code, task) {
  const calls = task.cases
    .map((c) => `  __r.push(JSON.stringify(${task.funcName}(${c.args.map(jsLiteral).join(", ")})));`)
    .join("\n");
  return `${code}\n;(function(){\n  const __r = [];\n${calls}\n  console.log("__FLINT__"+JSON.stringify(__r));\n})();\n`;
}

function pyHarness(code, task, csvPath) {
  const calls = task.cases
    .map((c) => {
      const args = c.args.map((a) => (a === "__CSV_PATH__" ? JSON.stringify(csvPath) : JSON.stringify(a)));
      return `__r.append(${task.funcName}(${args.join(", ")}))`;
    })
    .join("\n");
  return `${code}\nimport json\n__r = []\n${calls}\nprint("__FLINT__"+json.dumps(__r))\n`;
}

function runOne(cmd, args, harness, ext, task, compare) {
  const file = tmpFile(`t.${ext}`, harness);
  try {
    const out = execFileSync(cmd, [...args, file], { timeout: 8000, encoding: "utf8" });
    const line = out.split("\n").find((l) => l.startsWith("__FLINT__"));
    if (!line) return { ran: true, correct: false };
    const got = JSON.parse(line.slice("__FLINT__".length));
    return { ran: true, correct: task.cases.every((c, i) => compare(got[i], c.expect)) };
  } catch {
    return { ran: true, correct: false };
  }
}

function runJs(text, task) {
  const cands = candidateCodes(text, "js");
  if (!cands.length) return { ran: false, correct: false };
  let ran = false;
  for (const code of cands) {
    const r = runOne("node", ["--no-warnings"], jsHarness(code, task), "cjs", task,
      (g, e) => g === JSON.stringify(e));
    ran = ran || r.ran;
    if (r.correct) return { ran: true, correct: true };
  }
  return { ran, correct: false };
}

function runPython(text, task) {
  const cands = candidateCodes(text, "python");
  if (!cands.length) return { ran: false, correct: false };
  const csvPath = task.csvFixture ? tmpFile("data.csv", task.csvFixture) : null;
  let ran = false;
  for (const code of cands) {
    const r = runOne("python3", [], pyHarness(code, task, csvPath), "py", task,
      (g, e) => Math.abs(Number(g) - Number(e)) < 1e-9);
    ran = ran || r.ran;
    if (r.correct) return { ran: true, correct: true };
  }
  return { ran, correct: false };
}

function fidelity(text, task) {
  const t = text.toLowerCase();
  return (task.keywordsAnyGroups || []).every((group) => group.some((k) => t.includes(k.toLowerCase())));
}

function scoreRecord(rec) {
  const task = TASK_BY_ID[rec.task];
  const out = { ...rec, loc: loc(rec.result) };
  if (rec.error || !rec.result) return { ...out, correct: false, ran: false };
  if (task.kind === "prose") {
    out.correct = fidelity(rec.result, task);
  } else if (task.structural) {
    // match against CODE only, not prose: naming a lib you deliberately skipped ("Skipped:
    // Flatpickr") is good behavior, not a lib pull. Detect actual usage inside code blocks.
    const code = codeBlocks(rec.result).map((b) => b.code).join("\n");
    const native = task.nativePattern.test(code);
    const lib = task.libPattern.test(code);
    out.native = native;
    out.usedLib = lib;
    out.correct = native && !lib; // minimal correct solution = native input, no library
  } else if (task.lang === "python") {
    Object.assign(out, runPython(rec.result, task));
  } else {
    Object.assign(out, runJs(rec.result, task));
  }
  return out;
}

// ---- aggregation ------------------------------------------------------------
const median = (xs) => {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// Token count = tiktoken on the FINAL answer text, computed once via count_tokens.py.
// (Not usage.output_tokens, the headless agent loop inflates that.)
function tokenizeResults(texts) {
  const f = tmpFile("texts.json", JSON.stringify(texts));
  const out = execFileSync("python3", [join(HERE, "count_tokens.py"), f], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const tokenCounts = tokenizeResults(snapshot.records.map((r) => r.result || ""));
const scored = snapshot.records.map((r, i) => ({ ...scoreRecord(r), tokens: tokenCounts[i] }));
const arms = snapshot.metadata.arms;

function cell(taskId, arm) {
  const rows = scored.filter((r) => r.task === taskId && r.arm === arm);
  return {
    n: rows.length,
    tokens: median(rows.map((r) => r.tokens)),
    loc: median(rows.map((r) => r.loc)),
    correctCount: rows.filter((r) => r.correct).length,
    nativeCount: rows.filter((r) => r.native).length,
    libCount: rows.filter((r) => r.usedLib).length,
  };
}

const pct = (from, to) => (from && to != null ? Math.round((1 - to / from) * 100) : null);
const fmtPct = (x) => (x == null ? ", " : `${x < 0 ? "+" : "−"}${Math.abs(x)}%`);

// ---- report -----------------------------------------------------------------
const L = [];
const p = (s = "") => L.push(s);
const md = snapshot.metadata;
p(`# flint benchmark, measured results`);
p();
p(`_Snapshot: \`${SNAP.split("/").slice(-1)[0]}\` · generated ${md.generated_at}_`);
p(`_Model: \`${md.model}\` · reps/cell: ${md.reps} · arms: ${arms.join(", ")}_`);
p(`_Method: ${md.method}_`);
p();

const proseTasks = TASKS.filter((t) => t.kind === "prose");
const codeTasks = TASKS.filter((t) => t.kind === "code");

// Prose: token compression
p(`## Prose tasks, output tokens (tiktoken o200k_base ≈, of the final answer), median of ${md.reps}`);
p();
p(`| task | ${arms.join(" | ")} | flint vs baseline | flint vs terse |`);
p(`|------|${arms.map(() => "--:").join("|")}|--:|--:|`);
const proseRatios = { baseline: [], terse: [] };
for (const t of proseTasks) {
  const c = Object.fromEntries(arms.map((a) => [a, cell(t.id, a)]));
  const fid = arms.map((a) => `${c[a].tokens ?? ", "}${c[a].correctCount < c[a].n ? "⚠" : ""}`);
  // only let a cell count toward the headline reduction if flint cleared the fidelity floor
  // on every rep, a degenerate terse answer is not a win.
  const flintOk = c.flint && c.flint.correctCount === c.flint.n && c.flint.n > 0;
  const vb = pct(c.baseline?.tokens, c.flint?.tokens);
  const vt = pct(c.terse?.tokens, c.flint?.tokens);
  if (flintOk && vb != null) proseRatios.baseline.push(vb);
  if (flintOk && vt != null) proseRatios.terse.push(vt);
  p(`| ${t.id} | ${fid.join(" | ")} | ${fmtPct(vb)} | ${fmtPct(vt)} |`);
}
p();
p(`⚠ = at least one rep failed the keyword-fidelity floor (degenerate/incomplete answer).`);
p(`Median per-task reduction, flint vs baseline: **${fmtPct(median(proseRatios.baseline))}**, flint vs terse: **${fmtPct(median(proseRatios.terse))}**.`);
p();

// Code: LOC + correctness + tokens
p(`## Code tasks, lines of code & correctness, median of ${md.reps}`);
p();
p(`| task | metric | ${arms.join(" | ")} |`);
p(`|------|--------|${arms.map(() => "--:").join("|")}|`);
const locRatios = { baseline: [], terse: [] };
for (const t of codeTasks) {
  const c = Object.fromEntries(arms.map((a) => [a, cell(t.id, a)]));
  p(`| ${t.id} | LOC | ${arms.map((a) => c[a].loc ?? ", ").join(" | ")} |`);
  if (t.structural) {
    p(`| | native input | ${arms.map((a) => `${c[a].nativeCount}/${c[a].n}`).join(" | ")} |`);
    p(`| | pulled a lib | ${arms.map((a) => `${c[a].libCount}/${c[a].n}`).join(" | ")} |`);
  } else {
    p(`| | correct | ${arms.map((a) => `${c[a].correctCount}/${c[a].n}`).join(" | ")} |`);
  }
  // count LOC reduction only when flint produced a correct (executable) / minimal (structural) answer.
  const flintOk = c.flint && c.flint.n > 0 &&
    (t.structural ? c.flint.nativeCount === c.flint.n : c.flint.correctCount === c.flint.n);
  const vb = pct(c.baseline?.loc, c.flint?.loc);
  const vt = pct(c.terse?.loc, c.flint?.loc);
  if (flintOk && vb != null) locRatios.baseline.push(vb);
  if (flintOk && vt != null) locRatios.terse.push(vt);
}
p();
p(`Median per-task LOC reduction, flint vs baseline: **${fmtPct(median(locRatios.baseline))}**, flint vs terse: **${fmtPct(median(locRatios.terse))}**.`);
p();

// Token totals across everything (secondary headline)
p(`## All tasks, output tokens`);
p();
p(`| arm | total output tokens | median/task |`);
p(`|-----|--:|--:|`);
for (const a of arms) {
  const toks = TASKS.map((t) => cell(t.id, a).tokens).filter((x) => x != null);
  p(`| ${a} | ${toks.reduce((x, y) => x + y, 0)} | ${median(toks)} |`);
}
p();
p(`_Correctness gate: prose uses a keyword-fidelity floor; executable code is run against fixed cases; date-input is scored structurally (native \`<input type=date>\` vs a picker library). A terse answer that breaks the gate is not counted as a win._`);

const report = L.join("\n");
console.log(report);

// also drop the per-record scored table next to the snapshot for full reconciliation.
const detail = scored.map((r) => ({
  task: r.task, arm: r.arm, rep: r.rep,
  tokens: r.tokens, loc: r.loc, correct: r.correct,
  native: r.native ?? null, usedLib: r.usedLib ?? null,
  num_turns: r.num_turns ?? null, error: r.error ?? null,
}));
writeFileSync(SNAP.replace(/\.json$/, ".scored.json"), JSON.stringify(detail, null, 2));
