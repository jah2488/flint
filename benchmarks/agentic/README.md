# flint agentic A/B

Single-shot generation (the `benchmarks/` suite) can't exercise flint's build-side edges, the ones
that pay off across many turns and files: the minimal-code ladder, the nine principles, and the
refuse-to-over-claim reflex. This harness does. It runs **real Claude Code agentic sessions** on a
real (small, MIT, ours) repo and measures what the agent actually shipped.

## Why this is safe to share

The sandbox (`sandbox/`) is a small task API we authored, MIT-licensed, zero-dependency. Every diff
an agent produces and every number we report is on our own code, so results are publishable with no
third-party license, no proprietary leakage, and no training-data contamination from a famous repo.

## How a cell runs

For each `(ticket, arm, rep)`:

1. Copy `sandbox/` to an isolated temp dir and `git commit` a base.
2. Run a real Claude Code agentic session in it (`claude -p`, tools on, `bypassPermissions`,
   `--setting-sources project` so the operator's user-level `CLAUDE.md` and installed skills stay
   out). The **flint** arm appends the skill via `--append-system-prompt`; **baseline** appends
   nothing. `flint-lite` / `flint-ultra` add an intensity directive.
3. `git diff --numstat` the agent's changes (diff size + files touched).
4. Drop the ticket's **hidden acceptance test** into the worktree and run `node --test`. This gates
   correctness AND guardrails (e.g. the T2 acceptance test fails if the agent dropped title
   validation, even though the ticket never mentioned it).

## Tickets

`tickets.mjs`, three buckets:
- **over-build** (e.g. `T1-duedate`): a minimal solution is correct; an unconstrained agent tends to
  over-engineer (a date library, a `DateField` class). flint should stay minimal.
- **guardrail** (e.g. `T2-patch`): the ticket doesn't mention validation or 404; good engineering
  keeps them anyway. The acceptance test checks the agent didn't drop the guardrail.
- **control**: already-minimal tasks where flint should be a wash (proving it doesn't degrade good
  code).

## Run it

```bash
# pilot: 2 tickets x baseline/flint x 3 reps on haiku
node run-agentic.mjs --tickets T1-duedate,T2-patch --arms baseline,flint --reps 3

# scale: all tickets, add intensity arms and a second model
node run-agentic.mjs --arms baseline,flint --reps 5 --model claude-opus-4-8
```

Each record carries `testsPass`, `diffLines`, `files`, `turns`, `otoks`, and the raw `diff` (for the
over-engineering judge and for publishing). Snapshots land in `snapshots/`.

## What it measures, honestly

The claim this earns: **at equal acceptance-pass rate, flint ships a smaller diff and keeps the
guardrails an unconstrained agent drops.** It does NOT measure prose (that's the single-shot suite),
and it inherits the same `CLAUDE.md`-in-context caveat (conservative baseline). See `results/` for
the dated write-up and verdict.
