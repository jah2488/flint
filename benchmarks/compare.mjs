#!/usr/bin/env node
// "Why flint instead of just caveman / just ponytail?" answered numerically. Reads a merged scored
// snapshot (baseline + caveman + ponytail + flint) and computes, per arm and family, the reduction
// vs baseline using the SAME metrics as measure.mjs (prose = tiktoken tokens, code = LOC), gated on
// the same correctness flag (a broken or low-fidelity rep never counts). Then it plots a 2D scatter:
// x = code-LOC reduction, y = prose-token reduction. caveman wins prose only, ponytail wins code
// only, flint is the only arm strong on both. Numbers come straight from the scored records.
//
// Reproduce: score each source snapshot once (`node measure.mjs <snap>` writes its `.scored.json`),
// then run this. It merges the two scored files in memory, so no redundant combined snapshot is
// committed. Defaults: baseline/terse/flint from the n=20 run, caveman/ponytail from the comparison run.
//
// Usage: node compare.mjs [scored1.json scored2.json ...]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TASKS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const snaps = process.argv.length > 2
  ? process.argv.slice(2)
  : [
      join(HERE, "snapshots", "results-2026-06-19-haiku-n20.scored.json"),
      join(HERE, "snapshots", "results-cavepony-n20.scored.json"),
    ];
const rows = snaps.flatMap((f) => JSON.parse(readFileSync(f, "utf8")));

const median = (xs) => {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
// median of a metric over the CORRECT reps for one task+arm (null if none passed the gate)
const medianCorrect = (taskId, arm, metric) =>
  median(rows.filter((r) => r.task === taskId && r.arm === arm && r.correct).map((r) => r[metric]));

// per-family reduction vs baseline: per task, (1 - arm/baseline) on correct reps; median across tasks.
function reduction(arm, family) {
  const metric = family === "prose" ? "tokens" : "loc";
  const tasks = TASKS.filter((t) => (family === "prose" ? t.kind === "prose" : t.kind === "code"));
  const per = [];
  for (const t of tasks) {
    const a = medianCorrect(t.id, arm, metric);
    const b = medianCorrect(t.id, "baseline", metric);
    if (a != null && b) per.push(1 - a / b);
  }
  return median(per);
}

const ARMS = ["baseline", "caveman", "ponytail", "flint"];
const data = ARMS.map((arm) => ({
  arm,
  prose: Math.round((reduction(arm, "prose") ?? 0) * 100),
  code: Math.round((reduction(arm, "code") ?? 0) * 100),
}));
console.error("compare:", data.map((d) => `${d.arm} prose ${d.prose}% / code ${d.code}%`).join("  |  "));

// ---- scatter: x = code-LOC reduction, y = prose-token reduction (both higher = better) ----
const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const LABEL = { baseline: "baseline (no skill)", caveman: "caveman", ponytail: "ponytail", flint: "flint" };
const COLOR = { flint: "#d97706", caveman: "#0f766e", ponytail: "#7c3aed", baseline: "#9aa0a6" };

const all = data.flatMap((d) => [d.code, d.prose]);
const lo = Math.min(0, ...all), hi = Math.max(10, ...all);
const span = hi - lo || 1;
const X0 = 70, Y0 = 56, PW = 470, PH = 320;
const px = (v) => X0 + ((v - lo) / span) * PW;
const py = (v) => Y0 + (1 - (v - lo) / span) * PH;

const grid = [];
const step = span > 60 ? 20 : 10;
for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
  grid.push(`<line x1="${px(v)}" y1="${Y0}" x2="${px(v)}" y2="${Y0 + PH}" stroke="#eee"/>`);
  grid.push(`<text x="${px(v)}" y="${Y0 + PH + 15}" text-anchor="middle" class="cap">${v}%</text>`);
  grid.push(`<line x1="${X0}" y1="${py(v)}" x2="${X0 + PW}" y2="${py(v)}" stroke="#eee"/>`);
  grid.push(`<text x="${X0 - 8}" y="${py(v) + 4}" text-anchor="end" class="cap">${v}%</text>`);
}
// zero axes emphasized
const zx = px(0), zy = py(0);
const pts = data.map((d) => {
  const cx = px(d.code), cy = py(d.prose), skill = d.arm === "flint";
  const right = d.code < (lo + hi) / 2; // label side to keep on-canvas
  const lx = right ? cx + 11 : cx - 11, anchor = right ? "start" : "end";
  return `<circle cx="${cx}" cy="${cy}" r="${skill ? 9 : 6}" fill="${COLOR[d.arm]}"/>` +
    `<text x="${lx}" y="${cy + 4}" text-anchor="${anchor}" class="${skill ? "fv" : "lbl"}" fill="${COLOR[d.arm]}">${LABEL[d.arm]} (code ${d.code}%, prose ${d.prose}%)</text>`;
});
const H = Y0 + PH + 60;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 ${H}" font-family="${FONT}" role="img" aria-label="flint is the only arm with both high code-LOC reduction and high prose-token reduction; caveman wins prose only, ponytail wins code only"><style>.lbl{font-size:12px}.fv{font-size:12px;font-weight:700}.cap{fill:#9aa0a6;font-size:10px}.sub{fill:#374151;font-size:15px;font-weight:700}.ax{fill:#6b7280;font-size:11px}</style>
<text x="20" y="26" class="sub">Why not just caveman or just ponytail?</text>
<text x="20" y="44" class="cap">reduction vs baseline, higher = better. caveman cuts prose, ponytail cuts code; only flint does both at once.</text>
${grid.join("\n")}
<line x1="${zx}" y1="${Y0}" x2="${zx}" y2="${Y0 + PH}" stroke="#cbd0d6"/>
<line x1="${X0}" y1="${zy}" x2="${X0 + PW}" y2="${zy}" stroke="#cbd0d6"/>
<rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}" fill="none" stroke="#d8d8d8"/>
<text transform="translate(18,${Y0 + PH / 2}) rotate(-90)" text-anchor="middle" class="ax">prose-token reduction</text>
<text x="${X0 + PW / 2}" y="${H - 24}" text-anchor="middle" class="ax">code-LOC reduction</text>
${pts.join("\n")}
<text x="20" y="${H - 6}" class="cap">claude-haiku-4-5, ${rows.filter((r) => r.arm === "flint").length / TASKS.length || "n"}≈reps/cell median, correctness-gated. each skill at default intensity; only delta is the skill text.</text></svg>`;
writeFileSync(join(HERE, "..", "assets", "compare.svg"), svg);
console.error("wrote assets/compare.svg");
