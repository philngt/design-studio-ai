# Evaluation and strategy feedback loop

A rendered screen is evidence, not completion. Evaluate both implementation quality and whether the strategy produced the intended outcome.

## Loop

`hypothesis -> strategy -> implementation -> inspect -> measure -> diagnose -> revise`

Do not skip from a bad metric directly to a redesign. First distinguish implementation defects from a wrong strategy and identify the mechanism that plausibly connects the observation to the outcome.

## Before implementation

Define a baseline when available and state expected directional change. Useful product signals include:

- task completion;
- time to primary action;
- abandonment/drop-off by step;
- navigation depth or backtracking;
- error/retry rate;
- repeated opening of secondary controls;
- search/filter usage;
- permission refusal;
- upgrade conversion when monetization is in scope;
- accessibility findings;
- qualitative hesitation/confusion from usability observation.

Never invent a baseline when analytics do not exist.

## Heuristic evidence when analytics are absent

Use bounded proxies, clearly labeled as heuristics:

- number of simultaneously prominent choices;
- interactions required for the primary job;
- hierarchy levels before a frequent action;
- amount of state the user must remember across steps;
- touch-target and spacing problems;
- keyboard/focus reachability;
- overflow/clipping at target dimensions;
- whether loading/empty/error states expose a recovery path;
- whether primary and destructive actions compete visually;
- whether platform adaptation is merely geometric scaling.

These can detect risk; they do not prove user behavior.

## Runtime review

Inspect the actual runtime UI or rendered artifact at representative sizes. For Apple platforms include relevant compact and expanded layouts. For web include the narrowest supported viewport and wider intended states. Check interaction states, not only the default screenshot.

Review:

1. user job remains obvious;
2. first attention lands on the intended hierarchy;
3. primary action is efficient;
4. secondary actions remain discoverable without dominating;
5. state/feedback/recovery are legible;
6. content survives realistic strings and dynamic type/text scaling where applicable;
7. keyboard/focus/touch behavior matches the target environment;
8. platform-native expectations are respected unless the strategy records a reason not to;
9. implementation matches the strategy contract;
10. no visual improvement has silently worsened task flow.

When Design Studio AI visual inspection and observability tools are available, use them as evidence sources. A successful render/check alone does not establish product success.

## Diagnose disagreement

When results disagree with expectations, classify the failure:

- **implementation**: code/UI does not implement the contract correctly;
- **strategy**: contract was implemented but the chosen direction does not produce the expected outcome;
- **mechanism**: the causal explanation was incomplete or wrong;
- **measurement**: metric/proxy does not represent the intended outcome;
- **context change**: user, content, constraint, or platform environment changed;
- **unknown**: evidence is insufficient.

Change the smallest layer that explains the evidence. Do not rewrite the whole design system for a local implementation defect.

## Record learning

After meaningful validation, append a short strategy learning record:

```md
Observation:
Expected:
Actual:
Likely mechanism:
Decision:
Contract change:
Evidence still missing:
```

Repeated validated learning can later become a reusable principle or decision pattern. A single result should not automatically become a universal rule.
