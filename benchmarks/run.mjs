#!/usr/bin/env node
// Capture-only benchmark runner. For each (task, arm, rep) it calls the local
// `claude` CLI headlessly under a controlled REPLACED system prompt with all tools
// disabled (single-shot generation, no agent loop), and records the real Claude
// output-token count plus the raw answer text. It computes NO derived metrics, that
// is measure.mjs's job, reading the snapshot, so the raw outputs stay the source of truth.
//
// Usage:
//   node run.mjs [--model claude-haiku-4-5] [--reps 3] [--concurrency 4]
//                [--tasks id,id] [--arms baseline,terse,flint] [--out snapshots/<file>.json]
//
// Requires the `claude` CLI logged in. No API key needed.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TASKS, ARMS, BASE } from "./tasks.mjs";

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const MODEL = arg("model", "claude-haiku-4-5");
const REPS = parseInt(arg("reps", "3"), 10);
const CONCURRENCY = parseInt(arg("concurrency", "4"), 10);
const TASK_FILTER = arg("tasks", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ARM_FILTER = arg("arms", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const stamp = new Date().toISOString().slice(0, 10);
const OUT = arg("out", join(HERE, "snapshots", `results-${stamp}.json`));

// Build the flint arm's system prompt from the actual SKILL.md body (frontmatter stripped),
// prefixed with the same base as the other arms so the only delta is the skill text.
function flintBody(level) {
  const raw = readFileSync(join(HERE, "..", "skills", "flint", "SKILL.md"), "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const dir =
    level === "lite" ? "\n\nActive intensity: LITE. Apply the lite column of the Intensity table."
    : level === "ultra" ? "\n\nActive intensity: ULTRA. Apply the ultra column of the Intensity table."
    : level === "feral" ? "\n\nActive intensity: FERAL. Apply the feral row: maximum compression, code golf, guardrails off, readability sacrificed. Experimental; output is not for production."
    : ""; // full is the default
  return `${BASE}\n\n${body}${dir}`;
}

// Build a comparison arm from a vendored external skill (caveman, ponytail). Same construction as
// flintBody (BASE + SKILL.md body, frontmatter stripped, default intensity) so the only delta
// between arms is the skill text. Sources + commits are in skills/SOURCES.md.
function externalSkillBody(name) {
  const raw = readFileSync(join(HERE, "skills", `${name}.md`), "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  return `${BASE}\n\n${body}`;
}

function systemPromptFor(arm) {
  if (arm === "flint") return flintBody("full");
  if (arm === "flint-lite") return flintBody("lite");
  if (arm === "flint-ultra") return flintBody("ultra");
  if (arm === "flint-feral") return flintBody("feral");
  if (arm === "caveman" || arm === "ponytail") return externalSkillBody(arm);
  return ARMS[arm];
}

async function callClaude(prompt, system) {
  const args = [
    "-p", prompt,
    "--system-prompt", system,
    "--model", MODEL,
    "--output-format", "json",
    "--strict-mcp-config", // load no MCP servers
    "--allowed-tools", "", // whitelist nothing → no tools to call, model answers in chat
    "--permission-mode", "default",
    // load only project settings, not the operator's user-level config. NOTE: this does NOT fully
    // strip a user ~/.claude/CLAUDE.md (it still loads as memory), but it loads no user settings,
    // and the memory is constant across all arms so it can't bias the comparison. Do NOT add
    // --exclude-dynamic-system-prompt-sections: it re-injects that memory into the first user
    // message (verified during bring-up). See benchmarks/README.md "known, equal baseline".
    "--setting-sources", "project",
  ];
  const { stdout } = await exec("claude", args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 240_000,
  });
  const j = JSON.parse(stdout);
  return {
    // .result is the FINAL answer text. We tokenize it in measure.mjs rather than trust
    // usage.output_tokens, which the headless agent loop inflates (it counts every
    // intermediate turn, not the answer). num_turns is recorded to expose that loop.
    result: j.result ?? "",
    loop_output_tokens: j.usage?.output_tokens ?? null,
    num_turns: j.num_turns ?? null,
    is_error: !!j.is_error,
  };
}

async function withRetry(prompt, system) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await callClaude(prompt, system);
      if (!r.is_error && r.result && r.result.trim()) return r;
    } catch (e) {
      if (attempt === 1) return { result: "", error: String(e).slice(0, 200) };
    }
  }
  return { result: "", error: "empty after retry" };
}

async function pool(jobs, n, worker) {
  const results = new Array(jobs.length);
  let next = 0;
  async function run() {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await worker(jobs[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, run));
  return results;
}

async function main() {
  const tasks = TASK_FILTER.length ? TASKS.filter((t) => TASK_FILTER.includes(t.id)) : TASKS;
  const arms = ARM_FILTER.length ? ARM_FILTER : Object.keys(ARMS);

  const jobs = [];
  for (const task of tasks)
    for (const arm of arms)
      for (let rep = 0; rep < REPS; rep++) jobs.push({ task, arm, rep });

  console.error(
    `flint bench: ${tasks.length} tasks × ${arms.length} arms × ${REPS} reps = ${jobs.length} calls, model=${MODEL}, concurrency=${CONCURRENCY}`,
  );

  let done = 0;
  const records = await pool(jobs, CONCURRENCY, async ({ task, arm, rep }) => {
    const r = await withRetry(task.prompt, systemPromptFor(arm));
    done++;
    process.stderr.write(`\r  ${done}/${jobs.length} done`);
    return {
      task: task.id,
      arm,
      rep,
      loop_output_tokens: r.loop_output_tokens ?? null,
      num_turns: r.num_turns ?? null,
      error: r.error ?? null,
      result: r.result,
    };
  });
  process.stderr.write("\n");

  const snapshot = {
    metadata: {
      generated_at: new Date().toISOString(),
      model: MODEL,
      reps: REPS,
      arms,
      n_tasks: tasks.length,
      method:
        "claude -p, REPLACED system prompt per arm, no tools (--allowed-tools ''). Size metric = tiktoken o200k_base tokens of the final .result text (NOT usage.output_tokens, which the agent loop inflates). flint arm = base + SKILL.md body.",
    },
    records,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2));
  console.error(`wrote ${records.length} records → ${OUT}`);
  const errs = records.filter((r) => r.error).length;
  if (errs) console.error(`⚠ ${errs} records had errors (counted as missing, not scored)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
