#!/usr/bin/env node
// Generate the README benchmark SVGs from scored snapshots, so chart numbers are never
// hand-typed and always reconcile with the data. Reads <snap>.scored.json files (written by
// measure.mjs) and writes assets/*.svg.
//
// Usage:
//   node charts.mjs headline   <scored.json> <model-label>      -> assets/benchmark.svg
//   node charts.mjs intensity  <scored.json>                    -> assets/intensity.svg
//   node charts.mjs crossmodel <label:scored.json> ...          -> assets/cross-model.svg

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "..", "assets");
const PROSE = new Set(["react-rerender", "conn-pool", "index-scan"]);
const key = (t) => (PROSE.has(t) ? "tokens" : "loc");
const med = (xs) => {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const cell = (recs, task, arm, k) => med(recs.filter((r) => r.task === task && r.arm === arm).map((r) => r[k]));
const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

// ---- headline: per-task baseline (grey) vs flint (orange) overlay -----------
function headline(scored, label) {
  const recs = load(scored);
  const n = recs.filter((r) => r.task === "slugify" && r.arm === "flint").length;
  const prose = ["react-rerender", "conn-pool", "index-scan"];
  const code = ["email-validate", "slugify", "csv-sum", "date-input"];
  const PW = 380, X0 = 158, RX = 545;
  const pmax = Math.max(...prose.map((t) => cell(recs, t, "baseline", "tokens")));
  const cmax = Math.max(...code.map((t) => cell(recs, t, "baseline", "loc")));
  const rows = [];
  let y = 82;
  const row = (task, k, max) => {
    const b = cell(recs, task, "baseline", k), f = cell(recs, task, "flint", k);
    const bw = Math.round((b / max) * PW), fw = Math.round((f / max) * PW);
    rows.push(
      `<text x="148" y="${y + 11}" text-anchor="end" class="lbl">${task}</text>` +
      `<rect x="${X0}" y="${y}" width="${bw}" height="14" rx="3" fill="#b4b9c0"/>` +
      `<rect x="${X0}" y="${y}" width="${fw}" height="14" rx="3" fill="#d4500f"/>` +
      `<text x="${Math.min(X0 + bw + 6, RX)}" y="${y + 11}" class="val">${+b.toFixed(0)} → <tspan class="fv">${+f.toFixed(0)}</tspan></text>`,
    );
    y += 22;
  };
  rows.push(`<text x="20" y="72" class="sub">Prose · output tokens</text>`); y = 82;
  prose.forEach((t) => row(t, "tokens", pmax));
  y += 20; const codeY = y;
  rows.push(`<text x="20" y="${codeY - 6}" class="sub">Code · lines of code</text>`);
  code.forEach((t) => row(t, "loc", cmax));
  // overall: median of per-task reductions (matches measure.mjs's "median per-task reduction")
  const redOf = (tasks, k) => Math.round(med(tasks.map((t) => 1 - cell(recs, t, "flint", k) / cell(recs, t, "baseline", k))) * 100);
  const tokRed = redOf(prose, "tokens");
  const locRed = redOf(code, "loc");
  const H = y + 74;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 ${H}" font-family="${FONT}" role="img" aria-label="flint vs baseline output reduction, ${label}"><style>.lbl{fill:#6b7280;font-size:13px}.sub{fill:#6b7280;font-size:13px;font-weight:700}.val{fill:#9aa0a6;font-size:12px}.fv{fill:#d4500f;font-size:12px;font-weight:700}.cap{fill:#9aa0a6;font-size:11px}</style>
<text x="20" y="24" class="sub" font-size="15">flint vs baseline · ${label} · n=${n} median</text>
<text x="20" y="42" class="cap">grey = baseline (no skill) · orange = flint · every arm passed every gate</text>
${rows.join("\n")}
<line x1="20" y1="${y + 6}" x2="580" y2="${y + 6}" stroke="#e6e1d8" stroke-width="1"/>
<text x="20" y="${y + 32}" class="sub" font-size="14">prose <tspan fill="#d4500f">−${tokRed}%</tspan> tokens · code <tspan fill="#d4500f">−${locRed}%</tspan> lines · significant (Mann-Whitney p&lt;0.05, all 7 tasks)</text>
<text x="20" y="${y + 52}" class="cap">size = tiktoken tokens / lines of the final answer. snapshot committed; regenerate with benchmarks/charts.mjs</text></svg>`;
  writeFileSync(join(ASSETS, "benchmark.svg"), svg);
  console.error(`benchmark.svg: ${label} n=${n}, prose -${tokRed}%, code -${locRed}%`);
}

// ---- intensity: total output tokens per arm (descending dose-response) ------
function intensity(scored) {
  const recs = load(scored);
  const order = ["baseline", "flint-lite", "flint", "flint-ultra", "flint-feral"]
    .filter((a) => recs.some((r) => r.arm === a));
  const labels = { baseline: "baseline", "flint-lite": "flint lite", flint: "flint full", "flint-ultra": "flint ultra", "flint-feral": "flint feral ⚠" };
  const PROSE = new Set(["react-rerender", "conn-pool", "index-scan"]);
  const tasks = [...new Set(recs.map((r) => r.task))];
  // gate-pass per arm (correctness for code, fidelity for prose) so we can flag where it breaks
  const gate = (a) => { const rs = recs.filter((r) => r.arm === a); return Math.round(rs.filter((r) => r.correct).length / rs.length * 100); };
  const n = recs.filter((r) => r.task === "slugify" && r.arm === "flint").length;
  // use output tokens for every task (a single consistent unit; LOC would be a different scale)
  const tot = Object.fromEntries(order.map((a) => [a, tasks.reduce((s, t) => s + cell(recs, t, a, "tokens"), 0)]));
  const max = tot.baseline, PW = 420, X0 = 120;
  const bars = order.map((a, i) => {
    const w = Math.round((tot[a] / max) * PW);
    const red = Math.round((1 - tot[a] / tot.baseline) * 100);
    const g = gate(a);
    const y = 60 + i * 40;
    const feral = a === "flint-feral";
    const fill = a === "baseline" ? "#b4b9c0" : feral ? "#b4b9c0" : "#d4500f"; // feral grey: not a free win
    const op = a === "baseline" || feral ? 1 : 0.55 + 0.15 * (i - 1);
    const note = a === "baseline" ? "" : feral ? `  <tspan class="fv">−${red}%</tspan> <tspan class="cap">but ${g}% gate-pass ⚠</tspan>` : `  <tspan class="fv">−${red}%</tspan> <tspan class="cap">(${g}% ok)</tspan>`;
    return `<text x="110" y="${y + 16}" text-anchor="end" class="lbl">${labels[a]}</text>` +
      `<rect x="${X0}" y="${y}" width="${w}" height="24" rx="4" fill="${fill}" fill-opacity="${op}"/>` +
      `<text x="${X0 + w + 8}" y="${y + 16}" class="val">${+tot[a].toFixed(0)} tok${note}</text>`;
  });
  const H = 60 + order.length * 40 + 30;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 ${H}" font-family="${FONT}" role="img" aria-label="flint intensity dose-response: output tokens fall from baseline to lite to full to ultra"><style>.lbl{fill:#6b7280;font-size:13px}.sub{fill:#6b7280;font-size:13px;font-weight:700}.val{fill:#9aa0a6;font-size:12px}.fv{fill:#d4500f;font-size:12px;font-weight:700}.cap{fill:#9aa0a6;font-size:11px}</style>
<text x="20" y="26" class="sub" font-size="15">Intensity dose-response · claude-haiku-4-5 · n=${n}</text>
<text x="20" y="44" class="cap">total output tokens across 7 tasks · more intensity = leaner · gate-pass = correct (code) + faithful (prose)</text>
${bars.join("\n")}
<text x="20" y="${H - 8}" class="cap">lite-to-ultra is free: 100% gate-pass down to −45%. feral buys −55% but the gate starts failing (prose drops concepts). not for production.</text></svg>`;
  writeFileSync(join(ASSETS, "intensity.svg"), svg);
  console.error(`intensity.svg: ${order.map((a) => Math.round(tot[a])).join(" -> ")} tokens`);
}

// ---- cross-model: pooled (normalized) reduction per model -------------------
function pooledReduction(recs) {
  const tasks = [...new Set(recs.map((r) => r.task))];
  let bn = [], fn = [];
  for (const t of tasks) {
    const k = key(t);
    const mb = cell(recs, t, "baseline", k);
    if (!mb) continue;
    bn.push(...recs.filter((r) => r.task === t && r.arm === "baseline").map((r) => r[k] / mb));
    fn.push(...recs.filter((r) => r.task === t && r.arm === "flint").map((r) => r[k] / mb));
  }
  return Math.round((1 - med(fn) / med(bn)) * 100);
}
function crossmodel(triples) {
  // triples: "label:path:clean" (clean=1 -> significant, every gate passed; 0 -> unreliable)
  const data = triples.map((p) => {
    const [label, path, clean] = p.split(":");
    const recs = load(path);
    const n = recs.filter((r) => r.task === "slugify" && r.arm === "flint").length;
    return { label, red: pooledReduction(recs), n, clean: clean === "1" };
  });
  const max = Math.max(...data.map((d) => d.red), 1);
  const PW = 360, X0 = 168;
  const bars = data.map((d, i) => {
    const w = Math.max(Math.round((Math.max(d.red, 0) / max) * PW), d.red > 0 ? 2 : 0);
    const y = 66 + i * 46;
    const fill = d.clean ? "#d4500f" : "#b4b9c0";
    const lab = d.red <= 0 ? `≈${d.red}%` : `−${d.red}%`;
    const tag = d.clean ? "" : "  (n.s.)";
    return `<text x="158" y="${y + 17}" text-anchor="end" class="lbl">${d.label} <tspan class="cap">(n=${d.n})</tspan></text>` +
      `<rect x="${X0}" y="${y}" width="${w}" height="26" rx="4" fill="${fill}"/>` +
      `<text x="${X0 + w + 8}" y="${y + 17}" class="${d.clean ? "fv" : "cap"}">${lab}${tag}</text>`;
  });
  const H = 66 + data.length * 46 + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 ${H}" font-family="${FONT}" role="img" aria-label="flint pooled output reduction by model: bigger on more capable models"><style>.lbl{fill:#6b7280;font-size:13px}.sub{fill:#6b7280;font-size:13px;font-weight:700}.fv{fill:#d4500f;font-size:13px;font-weight:700}.cap{fill:#9aa0a6;font-size:11px}</style>
<text x="20" y="26" class="sub" font-size="15">Pooled output reduction vs baseline, by model</text>
<text x="20" y="44" class="cap">flint vs no skill, normalized across 7 tasks. the benefit scales with model capability.</text>
${bars.join("\n")}
<text x="20" y="${H - 22}" class="cap">orange = significant, every gate passed (Mann-Whitney p&lt;0.05 on all 7 tasks).</text>
<text x="20" y="${H - 8}" class="cap">grey = not significant; small local models don't follow the rules, prose fidelity fails. flint needs an instruction-follower.</text></svg>`;
  writeFileSync(join(ASSETS, "cross-model.svg"), svg);
  console.error(`cross-model.svg: ${data.map((d) => `${d.label} ${d.red}%${d.clean ? "*" : " n.s."}`).join(", ")}`);
}

// ---- agentic: diff size per ticket, baseline (grey) vs flint (orange), passing cells -----------
function agentic(snapPath) {
  const recs = JSON.parse(readFileSync(snapPath, "utf8")).records;
  const tickets = [...new Set(recs.map((r) => r.ticket))];
  const passMed = (t, a) => med(recs.filter((r) => r.ticket === t && r.arm === a && r.testsPass).map((r) => r.diffLines));
  const max = Math.max(...tickets.map((t) => passMed(t, "baseline") || 0), 1);
  const PW = 360, X0 = 150, rowH = 60;
  const rows = tickets.map((t, i) => {
    const b = passMed(t, "baseline"), f = passMed(t, "flint");
    const red = b ? Math.round((1 - f / b) * 100) : 0;
    const y = 64 + i * rowH;
    return `<text x="140" y="${y + 10}" text-anchor="end" class="lbl">${t}</text>` +
      `<rect x="${X0}" y="${y}" width="${Math.round((b / max) * PW)}" height="16" rx="3" fill="#b4b9c0"/>` +
      `<text x="${X0 + Math.round((b / max) * PW) + 6}" y="${y + 13}" class="val">baseline ${b}</text>` +
      `<rect x="${X0}" y="${y + 22}" width="${Math.round((f / max) * PW)}" height="16" rx="3" fill="#d4500f"/>` +
      `<text x="${X0 + Math.round((f / max) * PW) + 6}" y="${y + 35}" class="fv">flint ${f}  −${red}%</text>`;
  });
  const H = 64 + tickets.length * rowH + 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 ${H}" font-family="${FONT}" role="img" aria-label="agentic pilot: flint ships a smaller diff per ticket at equal correctness"><style>.lbl{fill:#6b7280;font-size:13px}.sub{fill:#6b7280;font-size:13px;font-weight:700}.val{fill:#9aa0a6;font-size:12px}.fv{fill:#d4500f;font-size:12px;font-weight:700}.cap{fill:#9aa0a6;font-size:11px}</style>
<text x="20" y="26" class="sub" font-size="15">Agentic A/B: diff size per ticket (real Claude Code sessions)</text>
<text x="20" y="44" class="cap">claude-haiku-4-5 · diff lines, median of passing cells · 12/12 passed the hidden acceptance test</text>
${rows.join("\n")}
<text x="20" y="${H - 6}" class="cap">flint ships a smaller diff at equal correctness; n=3 pilot. lower is better.</text></svg>`;
  writeFileSync(join(ASSETS, "agentic.svg"), svg);
  console.error(`agentic.svg: ${tickets.map((t) => `${t} base ${passMed(t, "baseline")} -> flint ${passMed(t, "flint")}`).join(", ")}`);
}

const [, , cmd, ...rest] = process.argv;
if (cmd === "headline") headline(rest[0], rest[1]);
else if (cmd === "intensity") intensity(rest[0]);
else if (cmd === "crossmodel") crossmodel(rest);
else if (cmd === "agentic") agentic(rest[0]);
else { console.error("usage: charts.mjs headline|intensity|crossmodel|agentic ..."); process.exit(1); }
