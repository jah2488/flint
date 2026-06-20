#!/usr/bin/env python3
# Significance + effect-size analysis for a scored snapshot (the <snap>.scored.json that
# measure.mjs writes). For each task and for the pooled set it reports, comparing flint vs
# baseline on the size metric (tokens for prose, LOC for code):
#   - medians and the % reduction
#   - a bootstrap 95% CI on that reduction (seeded, deterministic)
#   - a Mann-Whitney U two-sided p-value (normal approximation with tie correction)
# No scipy: MWU and the normal CDF are hand-rolled, so it runs anywhere.
#
# Usage: python3 stats.py benchmarks/snapshots/results-<...>.scored.json
import json
import math
import random
import sys
from statistics import median

PROSE = {"react-rerender", "conn-pool", "index-scan"}
RNG = random.Random(12345)  # fixed seed -> reproducible CIs


def metric_key(task):
    return "tokens" if task in PROSE else "loc"


def normal_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def mannwhitney_p(a, b):
    """Two-sided MWU p-value via normal approximation with tie correction."""
    n1, n2 = len(a), len(b)
    if n1 == 0 or n2 == 0:
        return float("nan")
    combined = sorted([(v, 0) for v in a] + [(v, 1) for v in b])
    # average ranks, track tie-group sizes for correction
    ranks = [0.0] * len(combined)
    i = 0
    ties = []
    while i < len(combined):
        j = i
        while j + 1 < len(combined) and combined[j + 1][0] == combined[i][0]:
            j += 1
        avg = (i + 1 + j + 1) / 2.0
        for k in range(i, j + 1):
            ranks[k] = avg
        ties.append(j - i + 1)
        i = j + 1
    r1 = sum(ranks[k] for k in range(len(combined)) if combined[k][1] == 0)
    u1 = r1 - n1 * (n1 + 1) / 2.0
    mu = n1 * n2 / 2.0
    n = n1 + n2
    tie_term = sum(t**3 - t for t in ties) / (n * (n - 1)) if n > 1 else 0.0
    sigma = math.sqrt(n1 * n2 / 12.0 * ((n + 1) - tie_term))
    if sigma == 0:
        return float("nan")
    z = (u1 - mu) / sigma
    # continuity correction
    z = (abs(u1 - mu) - 0.5) / sigma if abs(u1 - mu) > 0.5 else 0.0
    return 2 * (1 - normal_cdf(z))


def boot_ci(base, flint, B=5000):
    reds = []
    for _ in range(B):
        bb = [base[RNG.randrange(len(base))] for _ in base]
        ff = [flint[RNG.randrange(len(flint))] for _ in flint]
        mb = median(bb)
        if mb:
            reds.append(1 - median(ff) / mb)
    reds.sort()
    lo = reds[int(0.025 * len(reds))]
    hi = reds[int(0.975 * len(reds))]
    return lo, hi


def main():
    path = sys.argv[1]
    recs = json.load(open(path))
    tasks = sorted({r["task"] for r in recs})
    model = path.split("/")[-1]
    print(f"# significance: {model}")
    print(f"{'task':16}{'metric':7}{'base':>6}{'flint':>7}{'reduction':>11}{'95% CI':>16}{'MWU p':>10}")
    pooled_b, pooled_f, all_sig = [], [], True
    for t in tasks:
        k = metric_key(t)
        b = [r[k] for r in recs if r["task"] == t and r["arm"] == "baseline" and r[k] is not None]
        f = [r[k] for r in recs if r["task"] == t and r["arm"] == "flint" and r[k] is not None]
        if not b or not f:
            continue
        mb, mf = median(b), median(f)
        red = 1 - mf / mb if mb else 0
        lo, hi = boot_ci(b, f)
        p = mannwhitney_p(b, f)
        sig = p < 0.05
        all_sig = all_sig and sig
        # normalize each task's values to its own baseline median so prose+code pool fairly
        if mb:
            pooled_b += [v / mb for v in b]
            pooled_f += [v / mb for v in f]
        flag = "" if sig else "  (n.s.)"
        print(f"{t:16}{k:7}{mb:>6.0f}{mf:>7.0f}{-red*100:>10.0f}%   [{-hi*100:>3.0f}%,{-lo*100:>3.0f}%]{p:>10.2g}{flag}")
    # pooled (normalized) test
    mb, mf = median(pooled_b), median(pooled_f)
    red = 1 - mf / mb
    lo, hi = boot_ci(pooled_b, pooled_f)
    p = mannwhitney_p(pooled_b, pooled_f)
    print("-" * 73)
    print(f"{'POOLED (norm)':16}{'':7}{mb:>6.2f}{mf:>7.2f}{-red*100:>10.0f}%   [{-hi*100:>3.0f}%,{-lo*100:>3.0f}%]{p:>10.2g}")
    print(f"\nn per cell: {len([r for r in recs if r['task']==tasks[0] and r['arm']=='flint'])}  "
          f"| every task significant at p<0.05: {all_sig}")


if __name__ == "__main__":
    main()
