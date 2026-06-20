# flint benchmarks

Measures what flint actually changes in a model's output, against honest controls. Built on
the [caveman](https://github.com/juliusbrussee/caveman) three-arm eval design, extended with
[ponytail](https://github.com/DietrichGebert/ponytail)'s code-size + correctness gate.

## The three arms

Every task runs under three **replaced** system prompts (not appended, so Claude Code's own
harness prompt and your personal `CLAUDE.md` don't contaminate the baseline):

| arm | system prompt |
|-----|---------------|
| `baseline` | `You are a helpful senior software engineer answering a colleague's question.` |
| `terse` | baseline + `Answer concisely.` |
| `flint` | baseline + the full `skills/flint/SKILL.md` body |

The honest delta for flint is **`flint` vs `terse`**, how much the skill adds *on top of* a
plain "be concise" instruction. Comparing only to `baseline` conflates the skill with the
generic terseness ask (the confound caveman's harness flags). Both are reported.

## Why this design

- **Output measured on the final answer text, not the agent loop.** `claude -p` always runs a
  headless agent loop, and `usage.output_tokens` counts every intermediate turn, for a code task
  it inflated a 1,100-character answer to ~3,900 "output tokens". So we tokenize the **`.result`**
  field (the final answer the user would see) with **tiktoken `o200k_base`**, OpenAI's BPE, an
  approximation of Claude's tokenizer (ratios between arms are meaningful; absolute counts are
  approximate, exactly as caveman's eval notes). `num_turns` is recorded per call so loop noise is
  visible, not hidden.
- **No tools** (`--allowed-tools ""`) so the model answers in chat instead of trying to write files,
  and **`--strict-mcp-config`** so no MCP servers load. Real model output, not hand-written examples.
- **A known, equal baseline (with one honest caveat).** `claude -p` injects the operator's
  user-level `~/.claude/CLAUDE.md` into *every* arm. During bring-up this benchmark's "baseline" was
  caught reciting the author's own engineering principles and terseness rules. We tried to strip it
  (`--setting-sources project`, `--exclude-dynamic-system-prompt-sections`, an isolated
  `CLAUDE_CONFIG_DIR`); none reliably removed it, and the agent harness (correctly) refused to let
  the run relocate a global config file. So the CLAUDE.md is present in all three arms. Two reasons
  this does not break the comparison: it is **constant across arms** (the replaced system prompt is
  the only thing that differs), and in practice the baseline still **behaved** like a verbose vanilla
  assistant (long answers, offered alternatives), so the residual effect is small and, if anything,
  makes the baseline *terser* than truly vanilla, i.e. flint's measured gap is a **conservative lower
  bound**. A pristine "no CLAUDE.md" baseline would require running the harness on a machine without
  a user-level `~/.claude/CLAUDE.md`.
- **A correctness/fidelity gate**, so a degenerate terse answer can't "win" on tokens:
  - executable code (`email-validate`, `slugify`, `csv-sum`) is run against fixed cases;
  - `date-input` is scored structurally (native `<input type="date">` vs pulling a picker lib),
    the canonical over-build trap;
  - prose tasks must clear a keyword-fidelity floor: the answer still conveys the key claims,
    matched by concept (stem-level, so "reusable"/"reusing" count as the "reuse" concept) rather
    than exact spelling, and applied identically to every arm.
- **Capture separated from scoring.** `run.mjs` saves only raw model outputs + token counts to
  `snapshots/`. `measure.mjs` recomputes every derived number from that raw text, so the
  medians always reconcile from the on-disk source and can be re-scored without re-querying.

## Run it

Requires the `claude` CLI logged in (no API key) and Node ≥ 18 / Python 3.

```bash
# capture via the local `claude` CLI (default: all tasks x 3 arms, model claude-haiku-4-5)
node run.mjs --reps 20 --out snapshots/run.json

# or via any OpenAI-compatible endpoint: Ollama (local, no key) or OpenRouter (set a key env)
node run-openai.mjs --model qwen2.5-coder:3b-instruct-q8_0      # base-url defaults to localhost:11434/v1
node run-openai.mjs --model anthropic/claude-3.5-sonnet --base-url https://openrouter.ai/api/v1 --api-key-env OPENROUTER_API_KEY

# score (writes <snap>.scored.json), test significance, and regenerate the README charts
node measure.mjs snapshots/run.json
python3 stats.py snapshots/run.scored.json                      # Mann-Whitney U + bootstrap 95% CIs
node charts.mjs headline snapshots/run.scored.json claude-haiku-4-5
```

Arms include the intensity levels: `--arms baseline,flint-lite,flint,flint-ultra` drives the
dose-response. Flags: `--model`, `--reps`, `--concurrency`, `--tasks id,id`, `--arms`, `--out`.

## Read the numbers honestly

This is **single-shot generation**, not a multi-turn agent session. That cuts both ways and the
README headline reflects it:

- It **understates** the ponytail/eng-audit effect, the minimal-code ladder and principles pay
  off most across many turns and files, which a one-shot "write a function" prompt barely
  exercises. ponytail measured this gap directly: their agentic-on-a-real-repo benchmark is the
  honest one for code, and it lands lower than their single-shot numbers.
- It can **overstate** a prose win on tasks where a bare model rambles with options + commentary,
  which is prose, not substance.
- Tokens here are **output only**, and approximate (tiktoken, not Claude's exact tokenizer). flint
  adds input tokens on every turn (the skill re-injects), so output savings are not the whole
  economic picture; prompt caching offsets some of it.
- The headline run is n=20 on haiku and **significance-tested** (`stats.py`: Mann-Whitney U p<0.05
  on every task, pooled p≈0, 95% CIs exclude zero), and reproduced on Opus 4.8 (n=10). It is still
  **single-shot** and **single-vendor at scale**: it transfers poorly to small local models
  (qwen2.5-coder 3b/1.5b come out not-significant, prose fidelity fails), which is reported, not hidden.

See `results/` for dated snapshots and the written-up read of each run, including the cross-model
and intensity numbers and the full significance + transfer verdict.
