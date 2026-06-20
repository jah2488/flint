# agentic A/B: claude-haiku-4-5 · arms ['baseline', 'flint']
ticket        arm              pass  diffLines(med)  files  turns
T1-duedate    baseline          3/3              32      3     19
T1-duedate    flint             3/3              24      3     15
              (over-build)
T2-patch      baseline          3/3              25      2      9
T2-patch      flint             3/3               7      1      8
              (guardrail)

## flint vs baseline, diff size among acceptance-PASSING cells (equal correctness)
  T1-duedate     baseline    32 -> flint    24 lines  (-25%) [25% smaller]
  T2-patch       baseline    25 -> flint     7 lines  (-72%) [72% smaller]

## acceptance pass-rate (guardrails + correctness)
  T1-duedate     baseline       3/3
  T1-duedate     flint          3/3
  T2-patch       baseline       3/3
  T2-patch       flint          3/3

---

## ultravalidate pass (agentic pilot)

**Verdict: `supported` (pilot, n=3).** A real agentic A/B, correctness-gated, shows flint ships a
smaller diff at equal acceptance-pass. Small n and two tickets; a directional pilot that validates
the harness, not yet a significance-tested result.

**Weakest defensible restatement.** Across 12 real Claude Code agentic sessions (2 tickets x
baseline/flint x 3 reps, claude-haiku-4-5) in an isolated copy of an MIT sandbox repo, every session
passed the hidden acceptance test (12/12, including the guardrail checks). flint's median diff was
**25% smaller on the over-build ticket and 72% smaller on the guardrail ticket**, at equal
correctness. The 72% case is the eng-audit/ponytail thesis: flint reused the existing
requireTitle + store.update (7 lines) where baseline re-implemented more (25).

**Checks:** reconcile from raw snapshots/agentic-pilot.json (per-cell diffLines/testsPass); fairness
= same sandbox, ticket, model, isolated worktree per cell, only the appended skill differs; power =
WEAK (n=3, 2 tickets, one model), explicitly a pilot; confound = the operator's CLAUDE.md loads into
both arms (conservative); falsifier = "flint ships a same-or-larger diff at equal correctness" did
not hold on either ticket.

**Honest negative:** the guardrail-dropping hypothesis did NOT manifest here, baseline kept the T2
title-validation + 404 (3/3). The win was diff size at equal correctness, not flint rescuing a
dropped guardrail. A scaled run needs tickets where the lazy path is more tempting, plus Opus, more
reps for significance, and the over-engineering LLM-judge on the captured diffs.
