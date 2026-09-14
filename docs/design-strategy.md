# Design Strategy for agent-driven UI

Design Studio AI separates design reasoning from design execution so coding agents can make UI changes from explicit product decisions instead of vague styling prompts.

## Why this layer exists

A coding agent is strong at reading repositories, generating alternatives, implementing components, refactoring, and verifying software. It does not automatically possess the real-world grounding that a human designer gets from users, product constraints, analytics, and observed behavior.

The Design Strategy layer turns that grounding into a reusable contract:

```text
Product brief / existing product
              +
User evidence / measurements
              +
Mechanisms / design principles
              +
Platform capabilities
              ↓
       Design Strategy
              ↓
   Design Strategy Contract
              ↓
 Codex / Claude Code / agent
              ↓
        Runtime UI
              ↓
Visual inspection / metrics / feedback
              └───────────────↺
```

## Boundaries

### Design Strategy owns

- user job and primary outcome;
- information hierarchy;
- navigation and interaction model;
- content density and progressive disclosure;
- platform adaptation;
- important states and recovery behavior;
- alternatives and trade-offs;
- measurable success criteria.

### Design System owns

- reusable tokens;
- typography and color roles;
- spacing scales;
- components and variants;
- reusable interaction/visual patterns.

### Implementation owns

- SwiftUI/AppKit/web source structure;
- component extraction;
- framework state-management mechanics;
- rendering and performance details;
- tests and build integration.

Implementation must not silently override a product-level strategy decision.

## Strategy gate

For substantial UI work, use:

```text
Brief
  ↓
User job
  ↓
Primary outcome
  ↓
Evidence + constraints
  ↓
Relevant mechanisms
  ↓
Information hierarchy
  ↓
Platform adapter
  ↓
Structural alternatives
  ↓
Trade-off comparison
  ↓
Design Strategy Contract
  ↓
Implementation
  ↓
Runtime inspection
  ↓
Measurement / learning
  ↺
```

This prevents the common `brief -> code` shortcut where an agent must invent UX assumptions while implementing.

## Cross-platform model

The same product task may remain stable while interaction changes by environment:

| Environment | Typical strengths to exploit |
| --- | --- |
| iOS | touch-first focus, concise hierarchy, progressive disclosure, short paths |
| iPadOS | adaptive panes, persistent context, touch + keyboard/pointer, multi-selection |
| macOS | pointer/keyboard efficiency, menus, toolbars, inspectors, windows, higher density |
| Web | responsive reflow, URLs/history, keyboard + pointer + touch, semantics, network resilience |

Do not derive iPad or desktop UI by simply widening an iPhone layout.

## Repository integration

The installable skill lives under `skills/design-strategy/` and is intentionally independent from the existing `skills/design-studio-ai/` execution skill.

- `design-strategy` decides what/why and produces a strategy contract.
- `design-studio-ai` creates/edits/inspects structured designs and artifacts.
- project design systems provide reusable implementation language.
- visual inspection and observability provide evidence for the feedback loop.

Run `npm run pack:skill` to package both skills into `dist/`.

## Suggested agent workflow

1. Read the product brief and repository/project context.
2. Invoke the Design Strategy skill for a new flow or substantial redesign.
3. Save the resulting strategy contract with project planning artifacts when persistence is useful.
4. Implement with Codex/another coding agent or create the design through Design Studio AI.
5. Inspect actual runtime/rendered results.
6. Compare against the contract and available product evidence.
7. Update the strategy when evidence invalidates an assumption.

The strategy is a living decision artifact, not a one-time style specification.
