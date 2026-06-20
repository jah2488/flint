# feral: the compression frontier

arm            tokens(sum med)  vs base  code ok  prose ok
baseline                  2420        -      95%      100%
flint-lite                1449     -40%     100%      100%
flint                     1373     -43%     100%      100%
flint-ultra               1338     -45%     100%      100%
flint-feral               1084     -55%      98%       77%

frontier read: tokens should fall left->right; watch where code-ok / prose-ok drop off (the cost of going feral).

## Read

The question was: how far can we push the agent toward fewer tokens, even at the cost of
readability? Answer, measured on claude-haiku-4-5 (n=10, 5 intensity arms, 350 single-shot calls):

- **lite to ultra is free.** Output falls to -45% with the correctness + fidelity gate held at 100%.
  ultra is the tightest setting you would actually ship.
- **feral buys another ~10 points (-55%) and that is where it breaks.** Prose fidelity drops to 77%,
  almost entirely on conn-pool (3/10 faithful: the symbol-soup drops a load-bearing concept). Code
  still "passes" the gate (98%), but that overstates its safety: feral golfs away handling for inputs
  the fixed test cases never probe, so the gate cannot see the fragility it introduces.

## Verdict: `supported` (exploratory)

feral does compress further, and the cost is real and concentrated, not diffuse. It is an honest
frontier marker, not a recommended mode. The guardrails that lite-through-ultra keep are exactly what
feral abandons, and the gate drop is the price. Ship ultra; keep feral behind its disclaimer for
research and throwaway one-offs only.

Snapshot: results-2026-06-19-feral.json (baseline, flint-lite, flint, flint-ultra, flint-feral).
