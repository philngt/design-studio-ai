# Design Strategy for agent-driven UI

Design Studio AI separates design reasoning from design execution so coding agents can make UI changes from explicit product decisions instead of vague styling prompts.

## Why this layer exists

A coding agent is strong at reading repositories, generating alternatives, implementing components, refactoring, and verifying software. It does not automatically possess the real-world grounding that a human designer gets from users, product constraints, analytics, and observed behavior.

The Design Strategy layer turns that grounding into a reusable, persisted contract:

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
      (persisted + versioned)
              ↓
 Codex / Claude Code / agent
              ↓
        Runtime UI
              ↓
Visual inspection / metrics / feedback
              └───────────────↺
```

## First-class project object

A project can persist one current `design-strategy.v1` contract independently from its canvas and design system. The contract has its own revision and records the approved brief revision it was derived from.

That separation is intentional:

```text
Product brief          answers WHAT problem / outcome is in scope
      ↓
Design strategy        answers WHAT should win and WHY
      ↓
Design system          answers WHICH reusable visual language to use
      ↓
DesignDocument/code    answers HOW the chosen strategy is realized
```

Changing the brief does not silently rewrite strategy. Instead, the previous contract becomes stale because `sourceBriefRevision` no longer matches the approved brief. Agents must revise/regenerate and obtain approval again.

## Contract contents

The shared schema is `src/shared/design-strategy.ts`. A contract records:

- primary and secondary user jobs;
- primary and secondary business goals;
- facts, measurements, and assumptions as separate evidence classes;
- observation → mechanism → principle reasoning records;
- information hierarchy: primary, secondary, contextual, rare;
- attention strategy;
- navigation and interaction strategy;
- relationship-based layout model and intended density;
- visual hierarchy intent without arbitrary style tokens;
- platform adaptation for every selected App target;
- two to five materially different structural alternatives;
- the selected alternative, rationale, and rejected trade-offs;
- observable success criteria and a validation plan.

Strategy alternatives must differ in product/task structure. `blue vs orange`, `rounded vs square`, or `gradient vs flat` are visual variations, not strategy alternatives.

## App target manifests

For App projects the contract's `platformAdaptation` set must match `document.app.targets` exactly. The strategy generator receives the corresponding versioned target manifests, including input capabilities, layout bias, navigation mechanisms, density, and interaction expectations.

This prevents:

```text
Tablet = Mobile × 2
Desktop = Mobile × 4
```

Instead:

```text
Shared product intent
        +
Target capability manifest
        ↓
Target-specific navigation / interaction / density / persistence
```

## Persistence and HTTP API

Migration `0015-design-strategies.sql` creates owner-scoped strategy storage. The routes are mounted under the existing project API:

```text
GET  /api/projects/:id/strategy
PUT  /api/projects/:id/strategy
POST /api/projects/:id/strategy/generate
POST /api/projects/:id/strategy/approve
```

Writes use optimistic strategy revision checks independent from document revision. Generation and approval also require the exact approved brief revision.

`PUT` always writes a draft. Editing a strategy therefore invalidates approval by construction.

The server-side generator uses the same owner-configured BYOK text providers as other Studio generation features. The prompt explicitly separates evidence, mechanisms, principles, alternatives, trade-offs, strategy and measurable validation. Provider output is schema-validated before persistence.

## MCP / coding-agent workflow

The network MCP surface exposes the same project object through:

```text
get_design_strategy
generate_design_strategy
update_design_strategy
approve_design_strategy
```

A coding/design agent should use the sequence:

```text
get_project
    ↓
get_design_brief
    ↓
get_design_strategy
    ↓
missing / stale?
 ┌───────────────┐
 │               │
generate      prepare with
strategy      own model
 │               │
 └──────┬────────┘
        ↓
update persisted contract
        ↓
human reviews alternatives + trade-offs
        ↓
approve_design_strategy
        ↓
implementation
        ↓
inspect_design / visual inspection
        ↓
compare with success criteria
        ↺
```

Human approval remains a real gate. Agents must not infer strategy approval from a previously approved brief, silence, or the existence of an old design.

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

Implementation must not silently override a product-level strategy decision. If a technical constraint forces that, revise the strategy contract first.

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
Human approval
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

- `design-strategy` teaches the reasoning and persisted contract workflow.
- `design-studio-ai` creates/edits/inspects structured designs and artifacts.
- project design systems provide reusable implementation language.
- App target manifests provide explicit environment capabilities.
- visual inspection and observability provide evidence for the feedback loop.

Run `npm run pack:skill` to package both skills into `dist/`.

The strategy is a living decision artifact, not a one-time style specification.
