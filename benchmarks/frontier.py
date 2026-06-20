#!/usr/bin/env python3
# The compression frontier: for each intensity arm, total output tokens (size) AND the gate-pass
# rate (correctness for code, keyword-fidelity for prose). Shows where extra compression stops
# being free and starts breaking the answer. Reads a <snap>.scored.json from measure.mjs.
import json, sys
from statistics import median
PROSE = {"react-rerender", "conn-pool", "index-scan"}
d = json.load(open(sys.argv[1]))
arms_order = ["baseline", "flint-lite", "flint", "flint-ultra", "flint-feral"]
arms = [a for a in arms_order if any(r["arm"] == a for r in d)]
tasks = sorted({r["task"] for r in d})
def cellmed(t, a): return median([r["tokens"] for r in d if r["task"]==t and r["arm"]==a] or [0])
print(f"{'arm':14}{'tokens(sum med)':>16}{'vs base':>9}{'code ok':>9}{'prose ok':>10}")
base_tot = None
for a in arms:
    tot = sum(cellmed(t, a) for t in tasks)
    if a == "baseline": base_tot = tot
    code = [r for r in d if r["arm"]==a and r["task"] not in PROSE]
    prose = [r for r in d if r["arm"]==a and r["task"] in PROSE]
    cok = sum(1 for r in code if r["correct"]) / len(code) if code else 0
    pok = sum(1 for r in prose if r["correct"]) / len(prose) if prose else 0
    vs = f"-{round((1-tot/base_tot)*100)}%" if base_tot and a!='baseline' else "-"
    print(f"{a:14}{round(tot):>16}{vs:>9}{f'{round(cok*100)}%':>9}{f'{round(pok*100)}%':>10}")
print("\nfrontier read: tokens should fall left->right; watch where code-ok / prose-ok drop off (the cost of going feral).")
