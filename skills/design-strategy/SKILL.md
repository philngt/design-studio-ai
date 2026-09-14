---
name: design-strategy
description: Turn a product brief, existing UI, constraints, and observed evidence into an explicit cross-platform UI design strategy for iOS, iPadOS, macOS, and web before implementation.
---

# Design Strategy

Use this skill before substantial UI implementation or redesign. Its job is not to decorate screens. Its job is to turn product intent and evidence into explicit design decisions that another agent can implement and verify.

## Core model

Treat design as a decision system:

`goal + context + mechanism + evidence + constraints + alternatives + trade-offs -> strategy -> implementation -> measurement -> revision`

Separate these layers:

- **Design intelligence**: human factors, interaction mechanisms, durable principles, mental models.
- **Design strategy**: what the product should prioritize and why in this context.
- **Design system**: reusable visual and interaction language used to realize the strategy.
- **Design execution**: concrete SwiftUI/AppKit/web components, layout code, assets, and motion.

Never use a design-system choice as a substitute for a product or interaction decision.

## Required inputs

Reuse available project context before asking questions. Establish, at minimum: the user/audience, user job, primary outcome, target platform, required content/actions, constraints, available evidence, and existing design system/components. Mark missing evidence as unknown; do not turn assumptions into facts.

## Strategy gate

Before implementation:

1. Frame the user job, not merely the requested screen.
2. Define the primary outcome to optimize first.
3. Read the target environment and input model.
4. Rank information/actions as primary, secondary, contextual, or rare.
5. Explain relevant mechanisms such as cognitive load, attention competition, navigation depth, interruption, latency, and mode errors.
6. Generate materially different structural alternatives.
7. Compare trade-offs across usability, discoverability, efficiency, density, scalability, accessibility, implementation cost, and platform fit.
8. Choose a strategy and record why rejected alternatives lost.
9. Define observable success evidence.
10. Only then hand a Design Strategy Contract to the implementation agent.

If the user asks only for visual exploration, the contract may be lightweight, but still state the user job, platform, hierarchy, and evaluation criteria.

## Read the references

Read [core mechanisms and principles](references/core.md) for every strategy task. Then read [platform adapters](references/platforms.md) for the target environment. Use [decision patterns](references/decision-patterns.md) when selecting navigation, layout, interaction, disclosure, or density. Produce the output using [the strategy contract](references/strategy-contract.md), and close the loop with [evaluation](references/evaluation.md).

When working inside Design Studio AI, use the existing `design-studio-ai` skill for document operations, design briefs, design systems, visual inspection, export, and publishing. This skill owns the reasoning layer that should precede those operations.

## Platform rule

Do not treat responsive design as scaling one screen.

- iOS: optimize a focused touch-first task in a constrained viewport.
- iPadOS: exploit larger touch space, adaptive panes, multitasking, keyboard/pointer, and persistent context where useful.
- macOS: design for pointer + keyboard, windows, menus, toolbars, inspectors, denser information, and command efficiency.
- Web: design for responsive viewports, URL/browser state, keyboard + pointer + touch, semantic structure, accessibility, and variable network conditions.

Preserve the product's task model across platforms while adapting navigation and interaction to each environment.

## Evidence discipline

Distinguish fact, measurement, mechanism, assumption, principle, strategy, and implementation. A strategy without evidence may still be a reasonable hypothesis, but label it as such and define what would falsify it.

## Handoff to Codex or another coding agent

Do not hand off vague instructions such as `make it premium`, `improve UX`, or `modernize the UI`. Hand off an explicit contract containing user job, primary outcome, hierarchy, navigation, interaction model, disclosure, density, platform adaptation, constraints, rejected alternatives, success criteria, and open assumptions.

Implementation may choose code structure, but it must not silently change strategy. If technical constraints force a strategic change, surface the trade-off and revise the contract first.

## Completion

A strategy pass is complete when the primary job/outcome are explicit, platform behavior is intentional, important decisions have mechanisms or evidence behind them, meaningful alternatives were considered, success criteria are observable, assumptions are named, and implementation can proceed without inventing product-level decisions.

After implementation, inspect the actual runtime result and feed observed evidence back into the strategy. Design strategy is a feedback loop, not a one-time specification.
