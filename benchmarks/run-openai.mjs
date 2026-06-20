#!/usr/bin/env node
// Capture-only runner for any OpenAI-compatible /v1/chat/completions endpoint. Covers local
// Ollama (http://localhost:11434/v1, no key) and OpenRouter (https://openrouter.ai/api/v1, key in
// an env var) with the same arms, tasks, and snapshot format as run.mjs, so measure.mjs scores them
// identically. Unlike `claude -p`, this is a single completion per call (no agent loop), so the
// .result is the model's answer directly.
//
// Usage:
//   node run-openai.mjs --model qwen2.5-coder:3b-instruct-q8_0 [--base-url http://localhost:11434/v1]
//                       [--api-key-env OPENROUTER_API_KEY] [--reps 10] [--concurrency 2]
//                       [--tasks id,id] [--arms baseline,terse,flint] [--out path] [--temperature 0]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TASKS, ARMS, BASE } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const list = (n) => arg(n, "").split(",").map((s) => s.trim()).filter(Boolean);

const MODEL = arg("model", "");
const BASE_URL = arg("base-url", "http://localhost:11434/v1").replace(/\/$/, "");
const API_KEY = (() => { const e = arg("api-key-env", ""); return e ? process.env[e] : null; })();
const REPS = parseInt(arg("reps", "10"), 10);
const CONCURRENCY = parseInt(arg("concurrency", "2"), 10);
const TEMPERATURE = parseFloat(arg("temperature", "0"));
const TASK_FILTER = list("tasks");
const ARM_FILTER = list("arms");
if (!MODEL) { console.error("--model required"); process.exit(1); }
const slug = MODEL.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
const OUT = arg("out", join(HERE, "snapshots", `results-openai-${slug}.json`));

function flintBody() {
  const raw = readFileSync(join(HERE, "..", "skills", "flint", "SKILL.md"), "utf8");
  return `${BASE}\n\n${raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim()}`;
}
const systemFor = (arm) => (arm === "flint" ? flintBody() : ARMS[arm]);

async function call(system, prompt) {
  const headers = { "content-type": "application/json" };
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;
  const body = JSON.stringify({
    model: MODEL, temperature: TEMPERATURE,
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 180_000);
  try {
    const r = await fetch(`${BASE_URL}/chat/completions`, { method: "POST", headers, body, signal: ctl.signal });
    if (!r.ok) return { result: "", error: `http ${r.status}: ${(await r.text()).slice(0, 160)}` };
    const j = await r.json();
    return { result: j.choices?.[0]?.message?.content ?? "" };
  } catch (e) {
    return { result: "", error: String(e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(system, prompt) {
  for (let a = 0; a < 2; a++) {
    const r = await call(system, prompt);
    if (r.result && r.result.trim()) return r;
    if (a === 1) return r;
  }
}

async function pool(jobs, n, worker) {
  const out = new Array(jobs.length);
  let next = 0;
  const run = async () => { while (next < jobs.length) { const i = next++; out[i] = await worker(jobs[i]); } };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, run));
  return out;
}

async function main() {
  const tasks = TASK_FILTER.length ? TASKS.filter((t) => TASK_FILTER.includes(t.id)) : TASKS;
  const arms = ARM_FILTER.length ? ARM_FILTER : Object.keys(ARMS);
  const jobs = [];
  for (const task of tasks) for (const arm of arms) for (let rep = 0; rep < REPS; rep++) jobs.push({ task, arm, rep });
  console.error(`openai-compat bench: ${jobs.length} calls, model=${MODEL}, base=${BASE_URL}, concurrency=${CONCURRENCY}`);

  let done = 0;
  const records = await pool(jobs, CONCURRENCY, async ({ task, arm, rep }) => {
    const r = await withRetry(systemFor(arm), task.prompt);
    process.stderr.write(`\r  ${++done}/${jobs.length}`);
    return { task: task.id, arm, rep, num_turns: 1, error: r.error ?? null, result: r.result };
  });
  process.stderr.write("\n");

  const snapshot = {
    metadata: {
      generated_at: new Date().toISOString(), model: MODEL, reps: REPS, arms,
      n_tasks: tasks.length, endpoint: BASE_URL,
      method: `OpenAI-compatible /v1/chat/completions, temperature=${TEMPERATURE}, single completion (no agent loop). Size = tiktoken o200k_base tokens of the answer. flint arm = base + SKILL.md body.`,
    },
    records,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2));
  const errs = records.filter((r) => r.error).length;
  console.error(`wrote ${records.length} records -> ${OUT}${errs ? ` (${errs} errors)` : ""}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
