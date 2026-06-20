#!/usr/bin/env python3
# Aggregate an agentic A/B snapshot. Reports, per ticket and arm: acceptance pass-rate, median diff
# size (lines + files), and median turns. Then the flint-vs-baseline comparison among cells that
# PASSED acceptance (so "smaller diff" is at equal correctness, not bought by broken code).
import json
import sys
from statistics import median

snap = json.load(open(sys.argv[1]))
recs = snap["records"]
arms = snap["metadata"]["arms"]
tickets = sorted({r["ticket"] for r in recs})


def cells(t, a):
    return [r for r in recs if r["ticket"] == t and r["arm"] == a]


def med(xs):
    return median(xs) if xs else None


print(f"# agentic A/B: {snap['metadata'].get('model')} · arms {arms}")
print(f"{'ticket':14}{'arm':14}{'pass':>7}{'diffLines(med)':>16}{'files':>7}{'turns':>7}")
for t in tickets:
    bucket = next(r["bucket"] for r in recs if r["ticket"] == t)
    for a in arms:
        c = cells(t, a)
        n = len(c)
        npass = sum(1 for r in c if r["testsPass"])
        dl = med([r["diffLines"] for r in c])
        fl = med([r["files"] for r in c])
        tn = med([r["turns"] for r in c if r["turns"] is not None])
        print(f"{t:14}{a:14}{f'{npass}/{n}':>7}{dl if dl is not None else '-':>16}{fl if fl is not None else '-':>7}{tn if tn is not None else '-':>7}")
    print(f"{'':14}({bucket})")

print("\n## flint vs baseline, diff size among acceptance-PASSING cells (equal correctness)")
for t in tickets:
    bp = [r["diffLines"] for r in cells(t, "baseline") if r["testsPass"]]
    fp = [r["diffLines"] for r in cells(t, "flint") if r["testsPass"]]
    if bp and fp:
        mb, mf = med(bp), med(fp)
        red = round((1 - mf / mb) * 100) if mb else 0
        print(f"  {t:14} baseline {mb:>5} -> flint {mf:>5} lines  ({-red if red<0 else -red}%) [{red}% smaller]")
    else:
        print(f"  {t:14} not enough passing cells (baseline {len(bp)}, flint {len(fp)})")

print("\n## acceptance pass-rate (guardrails + correctness)")
for t in tickets:
    for a in arms:
        c = cells(t, a)
        print(f"  {t:14} {a:14} {sum(1 for r in c if r['testsPass'])}/{len(c)}")
errs = [r for r in recs if r.get("err")]
if errs:
    print(f"\n{len(errs)} session error(s):", [f"{r['ticket']}/{r['arm']}#{r['rep']}: {r['err']}" for r in errs][:5])
